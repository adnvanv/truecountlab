package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// The parts of the server's room state a bot needs (see server/games/table.js view()).
type roomMsg struct {
	T     string `json:"t"`
	Error string `json:"error"`
	Room  *struct {
		Code string `json:"code"`
		Game struct {
			Phase string `json:"phase"`
			Dealt int    `json:"dealt"`
			Turn  *struct {
				Seat int `json:"seat"`
				Hand int `json:"hand"`
			} `json:"turn"`
			Seats []*struct {
				Hands []struct {
					Total int `json:"total"`
					Cards []json.RawMessage
				} `json:"hands"`
			} `json:"seats"`
			You *struct {
				Seat      int              `json:"seat"`
				Bet       *json.RawMessage `json:"bet"`
				Insurance bool             `json:"insurance"`
				Moves     *struct {
					H, S, D, P bool
				} `json:"moves"`
				Check *struct {
					Pending bool `json:"pending"`
				} `json:"check"`
			} `json:"you"`
		} `json:"game"`
	} `json:"room"`
}

// A bot is one simulated player: one WebSocket connection, one seat.
type bot struct {
	id      int
	conn    *websocket.Conn
	stats   *stats
	seat    int
	code    chan string // the host bot reports its room code here
	pending atomic.Int64 // unix nanos of the action waiting for the server's answer, or 0
	kind    atomic.Value // "move", "bet", "insurance" or "check"
	last    string       // the last prompt answered, so repeats of the same state are ignored
}

func dial(ctx context.Context, cfg config, id int, st *stats) (*bot, error) {
	h := http.Header{}
	h.Set("Origin", cfg.origin)
	dctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(dctx, cfg.wsURL, &websocket.DialOptions{HTTPHeader: h})
	if err != nil {
		return nil, err
	}
	c.SetReadLimit(1 << 20)
	b := &bot{id: id, conn: c, stats: st}
	if err := b.send(ctx, map[string]any{"t": "hello", "guestToken": fmt.Sprintf("loadtest_%08d_%s", id, cfg.run), "guestName": fmt.Sprintf("Bot%d", id)}); err != nil {
		c.CloseNow()
		return nil, err
	}
	return b, nil
}

func (b *bot) send(ctx context.Context, msg any) error {
	data, _ := json.Marshal(msg)
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return b.conn.Write(wctx, websocket.MessageText, data)
}

// act sends a game action and starts its clock; the next state update stops it.
func (b *bot) act(ctx context.Context, kind string, msg map[string]any) {
	msg["t"] = "game"
	b.kind.Store(kind)
	b.pending.Store(time.Now().UnixNano())
	if err := b.send(ctx, msg); err != nil {
		b.stats.err("send")
	}
	b.stats.sent.Add(1)
}

// run reads messages until ctx ends, answering whatever the table asks for.
// The host creates a private table and shares its code; everyone else joins it.
func (b *bot) run(ctx context.Context, host bool, code string, seat int) {
	defer b.conn.CloseNow()
	b.seat = seat
	joined := false
	for {
		_, data, err := b.conn.Read(ctx)
		if err != nil {
			if ctx.Err() == nil {
				b.stats.err("read")
			}
			return
		}
		now := time.Now()
		b.stats.msgs.Add(1)
		b.stats.bytes.Add(int64(len(data)))
		var m roomMsg
		if err := json.Unmarshal(data, &m); err != nil {
			b.stats.err("json")
			continue
		}
		switch m.T {
		case "welcome":
			if host {
				b.send(ctx, map[string]any{"t": "create", "kind": "table", "visibility": "private"})
			} else {
				b.send(ctx, map[string]any{"t": "join", "code": code})
			}
		case "error", "noRoom", "needName":
			b.stats.err(m.T + ": " + m.Error)
		case "room":
			if t := b.pending.Swap(0); t != 0 {
				b.stats.observe(b.kind.Load().(string), now.Sub(time.Unix(0, t)))
			}
			if m.Room == nil {
				continue
			}
			if !joined {
				joined = true
				if host && b.code != nil {
					b.code <- m.Room.Code
				}
				b.act(ctx, "sit", map[string]any{"a": "sit", "seat": seat})
				continue
			}
			b.answer(ctx, &m)
		}
	}
}

// answer plays like a simple player: $25 bets, no insurance, hit below 17, double 10–11.
func (b *bot) answer(ctx context.Context, m *roomMsg) {
	g := m.Room.Game
	y := g.You
	if y == nil {
		return
	}
	turn := ""
	if g.Turn != nil {
		turn = fmt.Sprintf("%d.%d", g.Turn.Seat, g.Turn.Hand)
	}
	prompt := fmt.Sprintf("%s|%s|%d", g.Phase, turn, g.Dealt)
	if prompt == b.last {
		return // the same question again (someone else's update): already answered
	}
	switch {
	case y.Bet != nil:
		b.last = prompt
		b.act(ctx, "bet", map[string]any{"a": "bet", "amount": 25})
	case y.Insurance:
		b.last = prompt
		b.act(ctx, "insurance", map[string]any{"a": "insurance", "take": false})
	case y.Moves != nil && g.Turn != nil && y.Seat < len(g.Seats) && g.Seats[y.Seat] != nil:
		hands := g.Seats[y.Seat].Hands
		if g.Turn.Hand >= len(hands) {
			return
		}
		b.last = prompt
		total := hands[g.Turn.Hand].Total
		move := "S"
		switch {
		case y.Moves.D && (total == 10 || total == 11):
			move = "D"
		case total < 17:
			move = "H"
		}
		b.act(ctx, "move", map[string]any{"a": "act", "move": move})
	case y.Check != nil && y.Check.Pending:
		b.last = prompt
		b.act(ctx, "check", map[string]any{"a": "check", "rc": 0, "tc": 0})
	}
}

// Load test for TrueCountLab's live play: opens real WebSocket connections that sit at
// shared tables and play hands (5 players a table), in stages of more and more tables,
// and reports the round-trip time of every move (sent → the server's next state update),
// throughput, and the server's own CPU, memory and event-loop delay from /metrics.
//
// Run it against a test server, never the live site:
//
//	LIVE_MAX_PER_IP=100000 LIVE_MAX_ROOMS=100000 LIVE_ROOMS_PER_MIN=100000 PORT=3099 DATA_DIR=/tmp/lt node server.js
//	go run . -url http://127.0.0.1:3099 -steps 50,100,200 -duration 60s
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type config struct {
	base     string // http://host:port of the server
	wsURL    string
	origin   string
	steps    []int
	seats    int
	duration time.Duration
	settle   time.Duration
	slo      time.Duration
	out      string
	run      string // makes guest tokens unique per run
}

type stage struct {
	Tables        int                `json:"tables"`
	Players       int                `json:"players"`
	Seconds       float64            `json:"seconds"`
	Latency       map[string]summary `json:"latency"`
	ActionsPerSec float64            `json:"actions_per_sec"`
	MsgsPerSec    float64            `json:"state_msgs_per_sec"`
	MBPerSec      float64            `json:"mb_per_sec"`
	Errors        map[string]int     `json:"errors"`
	Server        map[string]float64 `json:"server"`
}

func main() {
	var cfg config
	var steps string
	flag.StringVar(&cfg.base, "url", "http://127.0.0.1:3099", "test server address (http://host:port)")
	flag.StringVar(&steps, "steps", "25,50,100", "tables per stage, comma separated")
	flag.IntVar(&cfg.seats, "seats", 5, "players per table (1-5)")
	flag.DurationVar(&cfg.duration, "duration", 45*time.Second, "how long to measure each stage")
	flag.DurationVar(&cfg.settle, "settle", 8*time.Second, "wait after adding tables before measuring")
	flag.DurationVar(&cfg.slo, "slo", 100*time.Millisecond, "p95 move round trip a stage must stay under to count as handled")
	flag.StringVar(&cfg.out, "out", "", "write the results as JSON here")
	flag.Parse()

	cfg.base = strings.TrimRight(cfg.base, "/")
	cfg.origin = cfg.base
	cfg.wsURL = strings.Replace(strings.Replace(cfg.base, "https://", "wss://", 1), "http://", "ws://", 1) + "/ws"
	cfg.run = strconv.FormatInt(time.Now().Unix(), 36)
	if cfg.seats < 1 || cfg.seats > 5 {
		fail("seats must be 1-5")
	}
	for _, s := range strings.Split(steps, ",") {
		n, err := strconv.Atoi(strings.TrimSpace(s))
		if err != nil || n < 1 {
			fail("bad -steps: " + steps)
		}
		cfg.steps = append(cfg.steps, n)
	}
	if !sort.IntsAreSorted(cfg.steps) {
		fail("-steps must go up")
	}
	if strings.Contains(cfg.base, "truecountlab.com") {
		fail("point this at a test server, not the live site")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	st := newStats()
	var wg sync.WaitGroup
	tables := 0
	var results []stage

	fmt.Printf("TrueCountLab load test → %s, %d players a table\n", cfg.base, cfg.seats)
	for _, target := range cfg.steps {
		start := time.Now()
		if err := addTables(ctx, cfg, st, &wg, tables, target); err != nil {
			fmt.Println("  stopped adding tables:", err)
			break
		}
		tables = target
		fmt.Printf("\n%d tables (%d players) up in %.1fs; settling %s, measuring %s…\n", target, target*cfg.seats, time.Since(start).Seconds(), cfg.settle, cfg.duration)
		if !sleep(ctx, cfg.settle) {
			break
		}
		st.reset()
		before := scrape(cfg.base)
		t0 := time.Now()
		if !sleep(ctx, cfg.duration) {
			break
		}
		secs := time.Since(t0).Seconds()
		after := scrape(cfg.base)
		lat, errs := st.snapshot()
		s := stage{
			Tables: target, Players: target * cfg.seats, Seconds: secs, Latency: lat, Errors: errs,
			ActionsPerSec: float64(st.sent.Load()) / secs,
			MsgsPerSec:    float64(st.msgs.Load()) / secs,
			MBPerSec:      float64(st.bytes.Load()) / secs / 1e6,
			Server:        serverNumbers(before, after, secs),
		}
		results = append(results, s)
		report(s)
	}

	// The headline: the biggest stage whose p95 move round trip stayed under the SLO, error-free.
	best := -1
	for i, s := range results {
		if s.Latency["move"].P95 < float64(cfg.slo.Milliseconds()) && len(s.Errors) == 0 {
			best = i
		}
	}
	if best >= 0 {
		b := results[best]
		fmt.Printf("\nHandled: %d concurrent tables (%d players), p95 move round trip %.1f ms (p99 %.1f ms), %.0f actions/s, server CPU %.0f%%.\n",
			b.Tables, b.Players, b.Latency["move"].P95, b.Latency["move"].P99, b.ActionsPerSec, b.Server["cpu_percent"])
	} else {
		fmt.Printf("\nNo stage stayed under p95 %s without errors.\n", cfg.slo)
	}
	if cfg.out != "" {
		data, _ := json.MarshalIndent(map[string]any{"server": cfg.base, "seats": cfg.seats, "slo_ms": cfg.slo.Milliseconds(), "stages": results, "at": time.Now().UTC()}, "", "  ")
		if err := os.WriteFile(cfg.out, data, 0o644); err != nil {
			fmt.Println("writing results:", err)
		}
	}
	stop()
	wg.Wait()
}

// addTables opens tables from `from` up to `to`, a few at a time.
func addTables(ctx context.Context, cfg config, st *stats, wg *sync.WaitGroup, from, to int) error {
	sem := make(chan struct{}, 25) // tables being set up at once
	errs := make(chan error, to-from)
	var setup sync.WaitGroup
	for t := from; t < to; t++ {
		sem <- struct{}{}
		setup.Add(1)
		go func(t int) {
			defer setup.Done()
			defer func() { <-sem }()
			if err := openTable(ctx, cfg, st, wg, t); err != nil {
				errs <- fmt.Errorf("table %d: %w", t, err)
			}
		}(t)
	}
	setup.Wait()
	close(errs)
	for err := range errs {
		return err
	}
	return nil
}

func openTable(ctx context.Context, cfg config, st *stats, wg *sync.WaitGroup, t int) error {
	host, err := dial(ctx, cfg, t*cfg.seats, st)
	if err != nil {
		return err
	}
	host.code = make(chan string, 1)
	wg.Add(1)
	go func() { defer wg.Done(); host.run(ctx, true, "", 0) }()
	var code string
	select {
	case code = <-host.code:
	case <-time.After(15 * time.Second):
		return fmt.Errorf("no room code")
	case <-ctx.Done():
		return ctx.Err()
	}
	for seat := 1; seat < cfg.seats; seat++ {
		b, err := dial(ctx, cfg, t*cfg.seats+seat, st)
		if err != nil {
			return err
		}
		wg.Add(1)
		go func(seat int) { defer wg.Done(); b.run(ctx, false, code, seat) }(seat)
	}
	return nil
}

// scrape reads the server's /metrics (only the plain "name value" lines).
func scrape(base string) map[string]float64 {
	out := map[string]float64{}
	r, err := http.Get(base + "/metrics")
	if err != nil {
		return out
	}
	defer r.Body.Close()
	sc := bufio.NewScanner(r.Body)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "#") || strings.Contains(line, "{") {
			continue
		}
		f := strings.Fields(line)
		if len(f) == 2 {
			if v, err := strconv.ParseFloat(f[1], 64); err == nil {
				out[f[0]] = v
			}
		}
	}
	return out
}

func serverNumbers(before, after map[string]float64, secs float64) map[string]float64 {
	return map[string]float64{
		"cpu_percent":         100 * (after["process_cpu_seconds_total"] - before["process_cpu_seconds_total"]) / secs,
		"rss_mb":              after["process_resident_memory_bytes"] / 1e6,
		"eventloop_p99_ms":    after["nodejs_eventloop_delay_p99_seconds"] * 1000,
		"eventloop_p50_ms":    after["nodejs_eventloop_delay_p50_seconds"] * 1000,
		"connections":         after["live_connections"],
		"tables":              after["live_rooms_table"],
		"hands_dealt_per_sec": (after["usage_hands_dealt"] - before["usage_hands_dealt"]) / secs,
	}
}

func report(s stage) {
	fmt.Printf("  round trip (ms)   count      p50      p95      p99      max\n")
	kinds := []string{"move", "bet", "insurance", "check", "all"}
	for _, k := range kinds {
		l, ok := s.Latency[k]
		if !ok || l.Count == 0 {
			continue
		}
		fmt.Printf("  %-12s %10d %8.1f %8.1f %8.1f %8.1f\n", k, l.Count, l.P50, l.P95, l.P99, l.Max)
	}
	fmt.Printf("  throughput: %.0f actions/s, %.0f state updates/s, %.1f MB/s to players, %.1f hands dealt/s\n", s.ActionsPerSec, s.MsgsPerSec, s.MBPerSec, s.Server["hands_dealt_per_sec"])
	fmt.Printf("  server: CPU %.0f%% of one core, memory %.0f MB, event-loop delay p50 %.1f ms / p99 %.1f ms, %0.f connections\n",
		s.Server["cpu_percent"], s.Server["rss_mb"], s.Server["eventloop_p50_ms"], s.Server["eventloop_p99_ms"], s.Server["connections"])
	if len(s.Errors) == 0 {
		fmt.Println("  errors: none")
	} else {
		fmt.Println("  errors:", s.Errors)
	}
}

func sleep(ctx context.Context, d time.Duration) bool {
	select {
	case <-time.After(d):
		return true
	case <-ctx.Done():
		return false
	}
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "loadtest:", msg)
	os.Exit(2)
}

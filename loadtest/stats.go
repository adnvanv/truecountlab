package main

import (
	"math"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// stats collects round-trip times (action sent → the server's next state update) by
// kind, plus message, byte and error counts. Safe for many goroutines.
type stats struct {
	mu        sync.Mutex
	latencies map[string][]time.Duration
	errors    map[string]int
	sent      atomic.Int64
	msgs      atomic.Int64
	bytes     atomic.Int64
}

func newStats() *stats {
	return &stats{latencies: map[string][]time.Duration{}, errors: map[string]int{}}
}

func (s *stats) observe(kind string, d time.Duration) {
	s.mu.Lock()
	s.latencies[kind] = append(s.latencies[kind], d)
	s.mu.Unlock()
}

func (s *stats) err(kind string) {
	s.mu.Lock()
	s.errors[kind]++
	s.mu.Unlock()
}

// reset starts a new measurement window (used after each ramp-up).
func (s *stats) reset() {
	s.mu.Lock()
	s.latencies = map[string][]time.Duration{}
	s.errors = map[string]int{}
	s.mu.Unlock()
	s.sent.Store(0)
	s.msgs.Store(0)
	s.bytes.Store(0)
}

type summary struct {
	Count int     `json:"count"`
	P50   float64 `json:"p50_ms"`
	P95   float64 `json:"p95_ms"`
	P99   float64 `json:"p99_ms"`
	Max   float64 `json:"max_ms"`
}

func summarize(ds []time.Duration) summary {
	if len(ds) == 0 {
		return summary{}
	}
	sorted := append([]time.Duration(nil), ds...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	at := func(p float64) float64 {
		i := int(math.Ceil(p*float64(len(sorted)))) - 1
		if i < 0 {
			i = 0
		}
		return float64(sorted[i].Microseconds()) / 1000
	}
	return summary{Count: len(sorted), P50: at(0.50), P95: at(0.95), P99: at(0.99), Max: float64(sorted[len(sorted)-1].Microseconds()) / 1000}
}

// snapshot copies the current window's numbers.
func (s *stats) snapshot() (map[string]summary, map[string]int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]summary{}
	all := []time.Duration{}
	for k, v := range s.latencies {
		out[k] = summarize(v)
		if k != "sit" {
			all = append(all, v...)
		}
	}
	out["all"] = summarize(all)
	errs := map[string]int{}
	for k, v := range s.errors {
		errs[k] = v
	}
	return out, errs
}

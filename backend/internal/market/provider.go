package market

import (
	"context"
	"fmt"
	"strings"
	"time"
)

func NewProvider(name string) (Provider, error) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "groww":
		return NewGrowwProvider()
	default:
		return nil, fmt.Errorf("unknown market provider %q (only groww is supported)", name)
	}
}

// BackoffSleep sleeps with exponential backoff for rate limits.
func BackoffSleep(attempt int) {
	d := time.Duration(attempt*attempt) * 500 * time.Millisecond
	if d > 10*time.Second {
		d = 10 * time.Second
	}
	time.Sleep(d)
}

func FetchWithBackoff(ctx context.Context, attempts int, fn func() error) error {
	var last error
	for i := 0; i < attempts; i++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := fn(); err != nil {
			last = err
			BackoffSleep(i + 1)
			continue
		}
		return nil
	}
	return last
}

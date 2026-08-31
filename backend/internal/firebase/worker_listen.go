package firebase

import (
	"context"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const workerListenDoc = "listen"

// IsListenWindowActive returns true when the UI has requested on-demand worker activity.
func (p *Publisher) IsListenWindowActive(ctx context.Context) (bool, error) {
	doc, err := p.client.Collection("worker").Doc(workerListenDoc).Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return false, nil
		}
		return false, err
	}
	data := doc.Data()
	active, _ := data["active"].(bool)
	if !active {
		return false, nil
	}
	until, _ := data["until"].(int64)
	return until > time.Now().UnixMilli(), nil
}

func IsQuotaError(err error) bool {
	if err == nil {
		return false
	}
	return status.Code(err) == codes.ResourceExhausted ||
		status.Code(err) == codes.Unavailable
}

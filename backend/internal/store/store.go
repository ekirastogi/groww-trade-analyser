package store

import (
	"sync"

	"github.com/ekanshrastogi/groww-pnl-analyzer/internal/models"
	"github.com/google/uuid"
)

type Store struct {
	mu      sync.RWMutex
	reports map[string]*models.Report
}

func New() *Store {
	return &Store{reports: make(map[string]*models.Report)}
}

func (s *Store) Save(report *models.Report) string {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := uuid.New().String()
	report.ID = id
	s.reports[id] = report
	return id
}

func (s *Store) Get(id string) (*models.Report, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	report, ok := s.reports[id]
	return report, ok
}

func (s *Store) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.reports, id)
}

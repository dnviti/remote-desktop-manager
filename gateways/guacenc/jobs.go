package main

import (
	"sync"
	"time"
)

type job struct {
	JobID       string  `json:"jobId"`
	Status      string  `json:"status"`
	FilePath    string  `json:"filePath,omitempty"`
	Resolution  string  `json:"resolution,omitempty"`
	CreatedAt   float64 `json:"createdAt,omitempty"`
	CompletedAt float64 `json:"completedAt,omitempty"`
	OutputPath  string  `json:"outputPath,omitempty"`
	FileSize    int64   `json:"fileSize,omitempty"`
	Error       string  `json:"error,omitempty"`
	Detail      string  `json:"detail,omitempty"`
	ReturnCode  int     `json:"returncode,omitempty"`
}

type jobStore struct {
	mu             sync.Mutex
	jobs           map[string]*job
	totalProcessed int64
	expiry         time.Duration
	maxConcurrent  int
}

func newJobStore(expiry time.Duration, maxConcurrent int) *jobStore {
	return &jobStore{
		jobs:          make(map[string]*job),
		expiry:        expiry,
		maxConcurrent: maxConcurrent,
	}
}

func (s *jobStore) create(filePath, resolution string) (*job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.cleanupExpiredLocked()
	active := s.activeCountLocked()
	if active >= s.maxConcurrent {
		return nil, errTooManyActiveJobs{active: active}
	}

	now := time.Now()
	j := &job{
		JobID:      newJobID(),
		Status:     "pending",
		FilePath:   filePath,
		Resolution: resolution,
		CreatedAt:  float64(now.UnixNano()) / float64(time.Second),
	}
	s.jobs[j.JobID] = j
	s.totalProcessed++
	return cloneJob(j), nil
}

func (s *jobStore) get(jobID string) *job {
	s.mu.Lock()
	defer s.mu.Unlock()
	if j, ok := s.jobs[jobID]; ok {
		return cloneJob(j)
	}
	return nil
}

func (s *jobStore) update(jobID, status string, apply func(*job)) {
	s.mu.Lock()
	defer s.mu.Unlock()

	j, ok := s.jobs[jobID]
	if !ok {
		return
	}
	j.Status = status
	if apply != nil {
		apply(j)
	}
	if status == "complete" || status == "error" {
		j.CompletedAt = float64(time.Now().UnixNano()) / float64(time.Second)
	}
}

func (s *jobStore) list() ([]job, int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.cleanupExpiredLocked()
	out := make([]job, 0, len(s.jobs))
	for _, j := range s.jobs {
		out = append(out, *cloneJob(j))
	}
	return out, len(out)
}

func (s *jobStore) activeCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.activeCountLocked()
}

func (s *jobStore) total() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.totalProcessed
}

func (s *jobStore) activeCountLocked() int {
	active := 0
	for _, j := range s.jobs {
		if j.Status == "pending" || j.Status == "converting" {
			active++
		}
	}
	return active
}

func (s *jobStore) cleanupExpiredLocked() {
	if s.expiry <= 0 {
		return
	}
	cutoff := time.Now().Add(-s.expiry)
	for id, j := range s.jobs {
		if j.CompletedAt == 0 {
			continue
		}
		if time.Unix(0, int64(j.CompletedAt*float64(time.Second))).Before(cutoff) {
			delete(s.jobs, id)
		}
	}
}

func cloneJob(j *job) *job {
	if j == nil {
		return nil
	}
	cp := *j
	return &cp
}

package files

import "context"

func (s Service) currentStageUsage(ctx context.Context, prefix string) (int64, error) {
	objects, err := s.objectStore().List(ctx, prefix)
	if err != nil {
		return 0, err
	}
	var total int64
	for _, item := range objects {
		total += item.Size
	}
	return total, nil
}

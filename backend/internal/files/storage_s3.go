package files

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

var ErrSharedFilesS3NotConfigured = errors.New("shared file object storage is not configured")

type s3ObjectStore struct {
	client           *s3.Client
	bucket           string
	prefix           string
	autoCreateBucket bool
}

type s3ObjectStoreConfig struct {
	Bucket           string
	Region           string
	Endpoint         string
	AccessKeyID      string
	SecretAccessKey  string
	Prefix           string
	ForcePathStyle   bool
	AutoCreateBucket bool
}

func LoadObjectStoreFromEnv(ctx context.Context) (ObjectStore, error) {
	cfg := s3ObjectStoreConfig{
		Bucket:           strings.TrimSpace(os.Getenv("SHARED_FILES_S3_BUCKET")),
		Region:           strings.TrimSpace(os.Getenv("SHARED_FILES_S3_REGION")),
		Endpoint:         strings.TrimSpace(os.Getenv("SHARED_FILES_S3_ENDPOINT")),
		AccessKeyID:      strings.TrimSpace(os.Getenv("SHARED_FILES_S3_ACCESS_KEY_ID")),
		SecretAccessKey:  loadSecretEnv("SHARED_FILES_S3_SECRET_ACCESS_KEY", "SHARED_FILES_S3_SECRET_ACCESS_KEY_FILE"),
		Prefix:           strings.Trim(strings.TrimSpace(os.Getenv("SHARED_FILES_S3_PREFIX")), "/"),
		ForcePathStyle:   parseEnvBool("SHARED_FILES_S3_FORCE_PATH_STYLE", false),
		AutoCreateBucket: parseEnvBool("SHARED_FILES_S3_AUTO_CREATE_BUCKET", false),
	}
	if cfg.Bucket == "" {
		return nil, ErrSharedFilesS3NotConfigured
	}
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}
	return NewS3ObjectStore(ctx, cfg)
}

func NewS3ObjectStore(ctx context.Context, cfg s3ObjectStoreConfig) (ObjectStore, error) {
	loaders := []func(*awsconfig.LoadOptions) error{awsconfig.WithRegion(cfg.Region)}
	if cfg.AccessKeyID != "" && cfg.SecretAccessKey != "" {
		loaders = append(loaders, awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		))
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, loaders...)
	if err != nil {
		return nil, err
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = cfg.ForcePathStyle
		if cfg.Endpoint != "" {
			o.BaseEndpoint = aws.String(cfg.Endpoint)
		}
	})
	return &s3ObjectStore{
		client:           client,
		bucket:           cfg.Bucket,
		prefix:           cfg.Prefix,
		autoCreateBucket: cfg.AutoCreateBucket,
	}, nil
}

func (s *s3ObjectStore) EnsureBucket(ctx context.Context) error {
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.bucket)})
	if err == nil {
		return nil
	}
	if !s.autoCreateBucket {
		return err
	}
	_, err = s.client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(s.bucket)})
	var owned *s3types.BucketAlreadyOwnedByYou
	var exists *s3types.BucketAlreadyExists
	if err == nil || errors.As(err, &owned) || errors.As(err, &exists) {
		return nil
	}
	return err
}

func (s *s3ObjectStore) Put(ctx context.Context, key string, payload []byte, contentType string, metadata map[string]string) (ObjectInfo, error) {
	fullKey := s.fullKey(key)
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(fullKey),
		Body:        bytes.NewReader(payload),
		ContentType: aws.String(contentType),
		Metadata:    cloneStringMap(metadata),
	})
	if err != nil {
		return ObjectInfo{}, err
	}

	return ObjectInfo{
		Key:         key,
		Size:        int64(len(payload)),
		ModifiedAt:  time.Now().UTC(),
		ContentType: contentType,
		Metadata:    cloneStringMap(metadata),
	}, nil
}

func (s *s3ObjectStore) Get(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error) {
	fullKey := s.fullKey(key)
	output, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(fullKey),
	})
	if err != nil {
		return nil, ObjectInfo{}, err
	}
	return output.Body, ObjectInfo{
		Key:         key,
		Size:        aws.ToInt64(output.ContentLength),
		ModifiedAt:  aws.ToTime(output.LastModified),
		ContentType: aws.ToString(output.ContentType),
		Metadata:    cloneStringMap(output.Metadata),
	}, nil
}

func (s *s3ObjectStore) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.fullKey(key)),
	})
	return err
}

func (s *s3ObjectStore) List(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	items := make([]ObjectInfo, 0)
	paginator := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(s.bucket),
		Prefix: aws.String(s.fullKey(prefix)),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, item := range page.Contents {
			key := strings.TrimPrefix(aws.ToString(item.Key), s.fullKey(""))
			info := ObjectInfo{
				Key:        key,
				Size:       aws.ToInt64(item.Size),
				ModifiedAt: aws.ToTime(item.LastModified),
			}
			head, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
				Bucket: aws.String(s.bucket),
				Key:    aws.String(aws.ToString(item.Key)),
			})
			if err == nil {
				info.ModifiedAt = parseMetadataTime(head.Metadata["mtime-unix"], aws.ToTime(head.LastModified))
				info.ContentType = aws.ToString(head.ContentType)
				info.Metadata = cloneStringMap(head.Metadata)
			}
			items = append(items, info)
		}
	}
	return items, nil
}

func (s *s3ObjectStore) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	output, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.fullKey(key)),
	})
	if err != nil {
		return ObjectInfo{}, err
	}
	return ObjectInfo{
		Key:         key,
		Size:        aws.ToInt64(output.ContentLength),
		ModifiedAt:  parseMetadataTime(output.Metadata["mtime-unix"], aws.ToTime(output.LastModified)),
		ContentType: aws.ToString(output.ContentType),
		Metadata:    cloneStringMap(output.Metadata),
	}, nil
}

func (s *s3ObjectStore) fullKey(key string) string {
	key = strings.TrimPrefix(strings.TrimSpace(key), "/")
	if s.prefix == "" {
		return key
	}
	if key == "" {
		return s.prefix + "/"
	}
	return s.prefix + "/" + key
}

func parseMetadataTime(raw string, fallback time.Time) time.Time {
	if raw == "" {
		return fallback
	}
	unixSeconds, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return fallback
	}
	return time.Unix(unixSeconds, 0).UTC()
}

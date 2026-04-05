package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"image"
	"image/color"
	"image/png"
	"math"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/catalog"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

const (
	tileSize         = 256
	minZoom          = 0
	maxNativeZoom    = 7
	maxDisplayZoom   = 12
	maxMercatorLat   = 85.05112878
	tileCacheControl = "public, max-age=86400, stale-while-revalidate=604800"
)

type coordinate [2]float64

type pixelPoint struct {
	x float64
	y float64
}

type tileKey struct {
	z uint8
	x uint32
	y uint32
}

type cachedTile struct {
	data []byte
	etag string
}

type tileMetadataResponse struct {
	Name          string     `json:"name"`
	Format        string     `json:"format"`
	TileSize      int        `json:"tileSize"`
	MinZoom       int        `json:"minZoom"`
	MaxNativeZoom int        `json:"maxNativeZoom"`
	MaxZoom       int        `json:"maxZoom"`
	Bounds        [4]float64 `json:"bounds"`
	URLTemplate   string     `json:"urlTemplate"`
	Graticule     []float64  `json:"graticule"`
	Attribution   string     `json:"attribution"`
}

type tileService struct {
	mu      sync.RWMutex
	cache   map[tileKey]cachedTile
	renders singleflight.Group
}

var (
	worldPolygons = [][]coordinate{
		{
			{71, -168}, {63, -155}, {56, -144}, {50, -131}, {44, -124}, {31, -114},
			{24, -107}, {16, -97}, {9, -84}, {18, -77}, {29, -82}, {37, -76},
			{46, -67}, {54, -61}, {60, -64}, {66, -92}, {71, -122}, {73, -150},
		},
		{
			{83, -74}, {80, -52}, {75, -31}, {68, -24}, {61, -38}, {63, -54},
			{71, -61}, {79, -69},
		},
		{
			{12, -81}, {8, -78}, {9, -68}, {6, -58}, {-2, -50}, {-12, -44},
			{-23, -45}, {-33, -54}, {-45, -66}, {-54, -72}, {-51, -77}, {-34, -74},
			{-17, -69}, {-4, -74}, {7, -79},
		},
		{
			{71, -10}, {72, 14}, {70, 38}, {68, 61}, {66, 87}, {63, 112}, {58, 138},
			{50, 154}, {40, 148}, {30, 131}, {22, 118}, {15, 104}, {8, 89}, {11, 73},
			{21, 58}, {30, 42}, {38, 28}, {47, 19}, {56, 8}, {64, -4},
		},
		{
			{37, -17}, {34, 2}, {32, 17}, {30, 29}, {23, 37}, {14, 45}, {3, 50},
			{-10, 44}, {-21, 34}, {-33, 22}, {-35, 9}, {-30, -2}, {-18, -8},
			{-5, -6}, {8, -10}, {21, -16}, {31, -12},
		},
		{
			{-10, 112}, {-15, 128}, {-22, 142}, {-33, 152}, {-39, 145}, {-43, 132},
			{-37, 116}, {-26, 112}, {-16, 114},
		},
		{
			{35, 129}, {40, 138}, {45, 145}, {43, 152}, {35, 146}, {32, 138},
		},
		{
			{-60, -180}, {-60, 180}, {-84, 180}, {-84, -180},
		},
	}
	graticuleLatitudes  = []float64{-60, -30, 0, 30, 60}
	graticuleLongitudes = []float64{-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150}
	landFill            = color.NRGBA{R: 148, G: 163, B: 184, A: 56}
	landStroke          = color.NRGBA{R: 15, G: 23, B: 42, A: 168}
	gridLine            = color.NRGBA{R: 148, G: 163, B: 184, A: 48}
	worldBounds         = [4]float64{-180, -maxMercatorLat, 180, maxMercatorLat}
)

func main() {
	tiles := newTileService()
	service := app.StaticService{
		Descriptor: catalog.MustService(contracts.ServiceMapAssets),
		Register: func(mux *http.ServeMux) {
			tiles.registerRoutes(mux)
		},
	}

	if err := app.Run(context.Background(), service); err != nil {
		panic(err)
	}
}

func newTileService() *tileService {
	return &tileService{
		cache: make(map[tileKey]cachedTile),
	}
}

func (s *tileService) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/tiles/world/metadata", s.handleWorldMetadata)
	mux.HandleFunc("GET /v1/tiles/world/{z}/{x}/{y}", s.handleWorldTile)
}

func (s *tileService) handleWorldMetadata(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=3600")
	app.WriteJSON(w, http.StatusOK, tileMetadataResponse{
		Name:          "world",
		Format:        "png",
		TileSize:      tileSize,
		MinZoom:       minZoom,
		MaxNativeZoom: maxNativeZoom,
		MaxZoom:       maxDisplayZoom,
		Bounds:        worldBounds,
		URLTemplate:   "/v1/tiles/world/{z}/{x}/{y}",
		Graticule:     []float64{30},
		Attribution:   "Arsenale IP geolocation basemap",
	})
}

func (s *tileService) handleWorldTile(w http.ResponseWriter, r *http.Request) {
	z, x, y, ok := parseTileRequest(r)
	if !ok {
		http.NotFound(w, r)
		return
	}

	tile, err := s.getTile(z, x, y)
	if err != nil {
		http.Error(w, "failed to render tile", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Cache-Control", tileCacheControl)
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("ETag", tile.etag)
	http.ServeContent(w, r, "", time.UnixMilli(0), bytes.NewReader(tile.data))
}

func parseTileRequest(r *http.Request) (uint8, uint32, uint32, bool) {
	zValue, err := strconv.ParseUint(r.PathValue("z"), 10, 8)
	if err != nil {
		return 0, 0, 0, false
	}
	xValue, err := strconv.ParseUint(r.PathValue("x"), 10, 32)
	if err != nil {
		return 0, 0, 0, false
	}
	yValue, err := strconv.ParseUint(r.PathValue("y"), 10, 32)
	if err != nil {
		return 0, 0, 0, false
	}

	z := uint8(zValue)
	if z < minZoom || z > maxNativeZoom {
		return 0, 0, 0, false
	}
	edge := uint32(1) << z
	x := uint32(xValue)
	y := uint32(yValue)
	if x >= edge || y >= edge {
		return 0, 0, 0, false
	}
	return z, x, y, true
}

func (s *tileService) getTile(z uint8, x uint32, y uint32) (cachedTile, error) {
	key := tileKey{z: z, x: x, y: y}

	s.mu.RLock()
	if tile, ok := s.cache[key]; ok {
		s.mu.RUnlock()
		return tile, nil
	}
	s.mu.RUnlock()

	result, err, _ := s.renders.Do(tileKeyString(key), func() (any, error) {
		s.mu.RLock()
		if tile, ok := s.cache[key]; ok {
			s.mu.RUnlock()
			return tile, nil
		}
		s.mu.RUnlock()

		rendered, renderErr := renderWorldTile(int(z), int(x), int(y))
		if renderErr != nil {
			return cachedTile{}, renderErr
		}
		sum := sha256.Sum256(rendered)
		tile := cachedTile{
			data: rendered,
			etag: `"` + hex.EncodeToString(sum[:]) + `"`,
		}

		s.mu.Lock()
		s.cache[key] = tile
		s.mu.Unlock()
		return tile, nil
	})
	if err != nil {
		return cachedTile{}, err
	}
	return result.(cachedTile), nil
}

func tileKeyString(key tileKey) string {
	return strconv.FormatUint(uint64(key.z), 10) + "/" +
		strconv.FormatUint(uint64(key.x), 10) + "/" +
		strconv.FormatUint(uint64(key.y), 10)
}

func renderWorldTile(z int, x int, y int) ([]byte, error) {
	img := image.NewNRGBA(image.Rect(0, 0, tileSize, tileSize))
	drawGraticule(img, z, x, y)

	for _, polygon := range worldPolygons {
		points := make([]pixelPoint, 0, len(polygon))
		for _, coord := range polygon {
			projected := projectLatLon(coord[0], coord[1], z)
			points = append(points, pixelPoint{
				x: projected.x - float64(x*tileSize),
				y: projected.y - float64(y*tileSize),
			})
		}
		fillPolygon(img, points, landFill)
		drawPolygonStroke(img, points, landStroke)
	}

	var buf bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := encoder.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func drawGraticule(img *image.NRGBA, z int, x int, y int) {
	tileOffsetX := float64(x * tileSize)
	tileOffsetY := float64(y * tileSize)

	for _, latitude := range graticuleLatitudes {
		projected := projectLatLon(latitude, 0, z)
		drawHorizontalLine(img, projected.y-tileOffsetY, gridLine)
	}
	for _, longitude := range graticuleLongitudes {
		projected := projectLatLon(0, longitude, z)
		drawVerticalLine(img, projected.x-tileOffsetX, gridLine)
	}
}

func drawHorizontalLine(img *image.NRGBA, y float64, tone color.NRGBA) {
	row := int(math.Round(y))
	if row < 0 || row >= tileSize {
		return
	}
	for col := 0; col < tileSize; col++ {
		blendPixel(img, col, row, tone)
	}
}

func drawVerticalLine(img *image.NRGBA, x float64, tone color.NRGBA) {
	col := int(math.Round(x))
	if col < 0 || col >= tileSize {
		return
	}
	for row := 0; row < tileSize; row++ {
		blendPixel(img, col, row, tone)
	}
}

func drawPolygonStroke(img *image.NRGBA, points []pixelPoint, tone color.NRGBA) {
	if len(points) < 2 {
		return
	}
	for index := range points {
		start := points[index]
		end := points[(index+1)%len(points)]
		clippedStart, clippedEnd, ok := clipLine(start, end)
		if !ok {
			continue
		}
		drawLine(img, clippedStart, clippedEnd, tone)
	}
}

func drawLine(img *image.NRGBA, start pixelPoint, end pixelPoint, tone color.NRGBA) {
	deltaX := end.x - start.x
	deltaY := end.y - start.y
	steps := int(math.Ceil(math.Max(math.Abs(deltaX), math.Abs(deltaY))))
	if steps == 0 {
		blendPixel(img, int(math.Round(start.x)), int(math.Round(start.y)), tone)
		return
	}
	for step := 0; step <= steps; step++ {
		progress := float64(step) / float64(steps)
		x := start.x + deltaX*progress
		y := start.y + deltaY*progress
		blendPixel(img, int(math.Round(x)), int(math.Round(y)), tone)
	}
}

func fillPolygon(img *image.NRGBA, points []pixelPoint, tone color.NRGBA) {
	if len(points) < 3 {
		return
	}
	intersections := make([]float64, 0, len(points))
	for row := 0; row < tileSize; row++ {
		scanY := float64(row) + 0.5
		intersections = intersections[:0]
		for index := range points {
			start := points[index]
			end := points[(index+1)%len(points)]
			if crossesScanline(start.y, end.y, scanY) {
				progress := (scanY - start.y) / (end.y - start.y)
				intersections = append(intersections, start.x+progress*(end.x-start.x))
			}
		}
		if len(intersections) < 2 {
			continue
		}
		sort.Float64s(intersections)
		for index := 0; index+1 < len(intersections); index += 2 {
			startX := int(math.Ceil(intersections[index]))
			endX := int(math.Floor(intersections[index+1]))
			if endX < 0 || startX >= tileSize {
				continue
			}
			if startX < 0 {
				startX = 0
			}
			if endX >= tileSize {
				endX = tileSize - 1
			}
			for col := startX; col <= endX; col++ {
				blendPixel(img, col, row, tone)
			}
		}
	}
}

func crossesScanline(startY float64, endY float64, scanY float64) bool {
	return (startY <= scanY && endY > scanY) || (endY <= scanY && startY > scanY)
}

func projectLatLon(latitude float64, longitude float64, zoom int) pixelPoint {
	clampedLat := math.Max(math.Min(latitude, maxMercatorLat), -maxMercatorLat)
	latRadians := clampedLat * math.Pi / 180
	scale := float64(tileSize) * math.Exp2(float64(zoom))
	return pixelPoint{
		x: ((longitude + 180) / 360) * scale,
		y: (1 - math.Log(math.Tan(latRadians)+1/math.Cos(latRadians))/math.Pi) * scale / 2,
	}
}

func clipLine(start pixelPoint, end pixelPoint) (pixelPoint, pixelPoint, bool) {
	const (
		leftCode   = 1
		rightCode  = 2
		topCode    = 4
		bottomCode = 8
	)
	const (
		minCoord = -1.0
		maxCoord = float64(tileSize)
	)

	outCode := func(point pixelPoint) int {
		code := 0
		if point.x < minCoord {
			code |= leftCode
		} else if point.x > maxCoord {
			code |= rightCode
		}
		if point.y < minCoord {
			code |= topCode
		} else if point.y > maxCoord {
			code |= bottomCode
		}
		return code
	}

	codeA := outCode(start)
	codeB := outCode(end)

	for {
		if codeA|codeB == 0 {
			return start, end, true
		}
		if codeA&codeB != 0 {
			return pixelPoint{}, pixelPoint{}, false
		}

		codeOut := codeA
		if codeOut == 0 {
			codeOut = codeB
		}

		next := pixelPoint{}
		switch {
		case codeOut&topCode != 0:
			next.y = minCoord
			next.x = start.x + (end.x-start.x)*(minCoord-start.y)/(end.y-start.y)
		case codeOut&bottomCode != 0:
			next.y = maxCoord
			next.x = start.x + (end.x-start.x)*(maxCoord-start.y)/(end.y-start.y)
		case codeOut&rightCode != 0:
			next.x = maxCoord
			next.y = start.y + (end.y-start.y)*(maxCoord-start.x)/(end.x-start.x)
		default:
			next.x = minCoord
			next.y = start.y + (end.y-start.y)*(minCoord-start.x)/(end.x-start.x)
		}

		if codeOut == codeA {
			start = next
			codeA = outCode(start)
			continue
		}
		end = next
		codeB = outCode(end)
	}
}

func blendPixel(img *image.NRGBA, x int, y int, tone color.NRGBA) {
	if x < 0 || x >= tileSize || y < 0 || y >= tileSize {
		return
	}
	offset := img.PixOffset(x, y)
	dstR := float64(img.Pix[offset+0])
	dstG := float64(img.Pix[offset+1])
	dstB := float64(img.Pix[offset+2])
	dstA := float64(img.Pix[offset+3]) / 255

	srcA := float64(tone.A) / 255
	outA := srcA + dstA*(1-srcA)
	if outA <= 0 {
		img.Pix[offset+0] = 0
		img.Pix[offset+1] = 0
		img.Pix[offset+2] = 0
		img.Pix[offset+3] = 0
		return
	}

	srcR := float64(tone.R)
	srcG := float64(tone.G)
	srcB := float64(tone.B)
	outR := (srcR*srcA + dstR*dstA*(1-srcA)) / outA
	outG := (srcG*srcA + dstG*dstA*(1-srcA)) / outA
	outB := (srcB*srcA + dstB*dstA*(1-srcA)) / outA

	img.Pix[offset+0] = uint8(math.Round(outR))
	img.Pix[offset+1] = uint8(math.Round(outG))
	img.Pix[offset+2] = uint8(math.Round(outB))
	img.Pix[offset+3] = uint8(math.Round(outA * 255))
}

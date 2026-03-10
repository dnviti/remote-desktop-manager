import { useState, useEffect, useMemo } from 'react';
import { Box, CircularProgress, Typography, Alert, Paper } from '@mui/material';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getTenantGeoSummary, type GeoSummaryPoint } from '../../api/audit.api';

// Fix default marker icons in Leaflet (broken with bundlers)
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface AuditGeoMapProps {
  onSelectCountry?: (country: string) => void;
}

/** Fit map bounds to all markers */
function FitBounds({ points }: { points: GeoSummaryPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
  }, [points, map]);
  return null;
}

function getMarkerRadius(count: number, maxCount: number): number {
  const minRadius = 6;
  const maxRadius = 28;
  if (maxCount <= 1) return minRadius;
  const ratio = Math.log(count + 1) / Math.log(maxCount + 1);
  return minRadius + ratio * (maxRadius - minRadius);
}

function getMarkerColor(count: number, maxCount: number): string {
  const ratio = maxCount > 1 ? count / maxCount : 0;
  if (ratio > 0.6) return '#d32f2f'; // high activity — red
  if (ratio > 0.3) return '#f57c00'; // medium — orange
  return '#1976d2'; // low — blue
}

export default function AuditGeoMap({ onSelectCountry }: AuditGeoMapProps) {
  const [points, setPoints] = useState<GeoSummaryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getTenantGeoSummary(30)
      .then((data) => { if (!cancelled) setPoints(data); })
      .catch(() => { if (!cancelled) setError('Failed to load geo summary'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const maxCount = useMemo(() => Math.max(...points.map((p) => p.count), 1), [points]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  }

  if (points.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography color="text.secondary">
          No geolocation data available for the last 30 days
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ position: 'relative', height: 500 }}>
      <MapContainer
        center={[20, 0]}
        zoom={2}
        style={{ width: '100%', height: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {points.map((point, idx) => {
          const radius = getMarkerRadius(point.count, maxCount);
          const color = getMarkerColor(point.count, maxCount);
          const label = [point.city, point.country].filter(Boolean).join(', ');

          return (
            <CircleMarker
              key={`${point.country}-${point.city}-${idx}`}
              center={[point.lat, point.lng]}
              radius={radius}
              pathOptions={{
                fillColor: color,
                color: color,
                weight: 2,
                opacity: 0.8,
                fillOpacity: 0.4,
              }}
              eventHandlers={{
                click: () => {
                  if (onSelectCountry && point.country) {
                    onSelectCountry(point.country);
                  }
                },
              }}
            >
              <Popup>
                <Box sx={{ minWidth: 160 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {point.count} event{point.count !== 1 ? 's' : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Last: {new Date(point.lastSeen).toLocaleString()}
                  </Typography>
                  {onSelectCountry && (
                    <Typography variant="caption" color="primary" sx={{ display: 'block', mt: 0.5, cursor: 'pointer' }}>
                      Click to filter by {point.country}
                    </Typography>
                  )}
                </Box>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Legend */}
      <Paper
        elevation={3}
        sx={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          zIndex: 1000,
          p: 1.5,
          minWidth: 140,
        }}
      >
        <Typography variant="caption" fontWeight={600} sx={{ mb: 0.5, display: 'block' }}>
          Event Density
        </Typography>
        {[
          { color: '#1976d2', label: 'Low' },
          { color: '#f57c00', label: 'Medium' },
          { color: '#d32f2f', label: 'High' },
        ].map(({ color, label }) => (
          <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
            <Typography variant="caption">{label}</Typography>
          </Box>
        ))}
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          Click marker to filter
        </Typography>
      </Paper>
    </Box>
  );
}

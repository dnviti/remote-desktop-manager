import { useState, useEffect, useRef, forwardRef } from 'react';
import {
  Dialog, AppBar, Toolbar, IconButton, Typography, Box, Slide,
  CircularProgress, Alert, Chip, Divider, Paper,
} from '@mui/material';
import type { TransitionProps } from '@mui/material/transitions';
import {
  Close as CloseIcon,
  Public as GlobeIcon,
  LocationOn as LocationIcon,
  Business as OrgIcon,
  Dns as DnsIcon,
  Schedule as TimezoneIcon,
  Shield as ShieldIcon,
  PhoneAndroid as MobileIcon,
  VpnLock as VpnIcon,
  Storage as HostingIcon,
} from '@mui/icons-material';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../../api/client';
import { countryFlag } from './IpGeoCell';

// Fix default marker icons in Leaflet (broken with bundlers)
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const SlideUp = forwardRef(function SlideUp(
  props: TransitionProps & { children: React.ReactElement },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

interface IpApiData {
  status: 'success' | 'fail';
  message?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  zip?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  isp?: string;
  org?: string;
  as?: string;
  asname?: string;
  mobile?: boolean;
  proxy?: boolean;
  hosting?: boolean;
  query?: string;
}

interface GeoIpDialogProps {
  open: boolean;
  onClose: () => void;
  ipAddress: string | null;
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75 }}>
      <Box sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center' }}>{icon}</Box>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 100, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  );
}

export default function GeoIpDialog({ open, onClose, ipAddress }: GeoIpDialogProps) {
  const [data, setData] = useState<IpApiData | null>(null);
  const [error, setError] = useState('');
  const [fetchKey, setFetchKey] = useState(0);
  const loadingRef = useRef(false);
  const [loading, setLoading] = useState(false);

  // Trigger a new fetch when the dialog opens with a new IP
  const prevIpRef = useRef<string | null>(null);
  if (open && ipAddress && ipAddress !== prevIpRef.current) {
    prevIpRef.current = ipAddress;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    setData(null);
    setFetchKey((k) => k + 1);
  }
  if (!open && prevIpRef.current !== null) {
    prevIpRef.current = null;
  }

  useEffect(() => {
    if (!open || !ipAddress) return;
    let cancelled = false;

    api.get(`/geoip/${encodeURIComponent(ipAddress)}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err: unknown) => {
        if (!cancelled) {
          const axiosErr = err as { response?: { data?: { message?: string } }; message?: string };
          setError(axiosErr.response?.data?.message || axiosErr.message || 'Failed to look up IP');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  const hasCoords = data && typeof data.lat === 'number' && typeof data.lon === 'number' && (data.lat !== 0 || data.lon !== 0);
  const flag = data?.countryCode ? countryFlag(data.countryCode) : '';
  const locationParts = [data?.city, data?.regionName, data?.country].filter(Boolean);

  return (
    <Dialog fullScreen open={open} onClose={onClose} TransitionComponent={SlideUp}>
      <AppBar position="static" sx={{ position: 'relative' }}>
        <Toolbar variant="dense">
          <IconButton edge="start" color="inherit" onClick={onClose}>
            <CloseIcon />
          </IconButton>
          <Typography variant="h6" sx={{ ml: 1, flex: 1 }}>
            IP Geolocation {ipAddress ? `\u2014 ${ipAddress}` : ''}
          </Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Box sx={{ p: 3 }}>
            <Alert severity="error">{error}</Alert>
          </Box>
        )}

        {data && !loading && (
          <Box sx={{ display: 'flex', flex: 1, flexDirection: { xs: 'column', md: 'row' } }}>
            {/* Info panel */}
            <Box sx={{ width: { xs: '100%', md: 420 }, flexShrink: 0, p: 3, overflow: 'auto' }}>
              <Paper elevation={0} sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2, mb: 2 }}>
                <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  {flag && <span style={{ fontSize: '1.5rem' }}>{flag}</span>}
                  {data.query}
                </Typography>
                {locationParts.length > 0 && (
                  <Typography variant="body1" color="text.secondary">
                    {locationParts.join(', ')}
                  </Typography>
                )}
              </Paper>

              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, mt: 2 }}>
                Location
              </Typography>
              <InfoRow icon={<GlobeIcon fontSize="small" />} label="Country" value={
                data.country ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {flag && <span>{flag}</span>}
                    {data.country} ({data.countryCode})
                  </Box>
                ) : null
              } />
              <InfoRow icon={<LocationIcon fontSize="small" />} label="Region" value={data.regionName} />
              <InfoRow icon={<LocationIcon fontSize="small" />} label="City" value={data.city} />
              <InfoRow icon={<LocationIcon fontSize="small" />} label="ZIP" value={data.zip} />
              <InfoRow icon={<LocationIcon fontSize="small" />} label="Coordinates" value={
                hasCoords ? `${(data.lat ?? 0).toFixed(4)}, ${(data.lon ?? 0).toFixed(4)}` : undefined
              } />
              <InfoRow icon={<TimezoneIcon fontSize="small" />} label="Timezone" value={data.timezone} />

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                Network
              </Typography>
              <InfoRow icon={<OrgIcon fontSize="small" />} label="ISP" value={data.isp} />
              <InfoRow icon={<OrgIcon fontSize="small" />} label="Organization" value={data.org} />
              <InfoRow icon={<DnsIcon fontSize="small" />} label="AS" value={data.as} />
              <InfoRow icon={<DnsIcon fontSize="small" />} label="AS Name" value={data.asname} />

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                Flags
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {data.proxy && (
                  <Chip icon={<VpnIcon />} label="Proxy / VPN / Tor" color="warning" size="small" />
                )}
                {data.hosting && (
                  <Chip icon={<HostingIcon />} label="Hosting / Datacenter" color="info" size="small" />
                )}
                {data.mobile && (
                  <Chip icon={<MobileIcon />} label="Mobile / Cellular" color="default" size="small" />
                )}
                {!data.proxy && !data.hosting && !data.mobile && (
                  <Chip icon={<ShieldIcon />} label="Residential" color="success" size="small" variant="outlined" />
                )}
              </Box>
            </Box>

            {/* Map */}
            <Box sx={{ flex: 1, minHeight: { xs: 300, md: 'auto' }, position: 'relative' }}>
              {hasCoords ? (
                <MapContainer
                  center={[data.lat ?? 0, data.lon ?? 0]}
                  zoom={10}
                  style={{ width: '100%', height: '100%', minHeight: 400 }}
                  scrollWheelZoom
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <Marker position={[data.lat ?? 0, data.lon ?? 0]}>
                    <Popup>
                      <strong>{data.query}</strong><br />
                      {locationParts.join(', ')}<br />
                      {data.isp && <>ISP: {data.isp}</>}
                    </Popup>
                  </Marker>
                </MapContainer>
              ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  <Typography color="text.secondary">No coordinates available for this IP</Typography>
                </Box>
              )}
            </Box>
          </Box>
        )}
      </Box>
    </Dialog>
  );
}

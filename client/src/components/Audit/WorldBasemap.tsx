import { TileLayer } from 'react-leaflet';
import {
  WORLD_BASEMAP_BOUNDS,
  WORLD_BASEMAP_MAX_NATIVE_ZOOM,
  WORLD_BASEMAP_MAX_ZOOM,
  WORLD_BASEMAP_TILE_URL,
} from '../../api/mapAssets.api';

const TRANSPARENT_TILE_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

export function WorldBasemap() {
  return (
    <TileLayer
      url={WORLD_BASEMAP_TILE_URL}
      attribution='Arsenale basemap'
      bounds={WORLD_BASEMAP_BOUNDS}
      errorTileUrl={TRANSPARENT_TILE_DATA_URL}
      maxNativeZoom={WORLD_BASEMAP_MAX_NATIVE_ZOOM}
      maxZoom={WORLD_BASEMAP_MAX_ZOOM}
      noWrap
      opacity={1}
      tileSize={256}
      updateWhenIdle
    />
  );
}

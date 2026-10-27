import { Camera, GeoJSONSource, Layer, Map, type MapRef } from '@maplibre/maplibre-react-native';
import type { OutageDetailDto } from '@struja/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '../design/components';
import { useTheme } from '../design/theme';
import { MAP_CONFIG } from './config';
import { boundsOf, drawable, type LngLatPoint } from './geo';
import { installMapLogging } from './logging';
import { BASE_LAYER_IDS, buildMapStyle, mapColors, type Script } from './style';

installMapLogging();

export const MAP_HEIGHT = 240;
const POLL_MS = 600;

// The affected streets: thin when the whole area is in view, thick when zoomed in; `extra` widens the casing.
const lineWidth = (extra: number) =>
  ['interpolate', ['linear'], ['zoom'], 11, 3 + extra, 15, 5 + extra, 18, 8 + extra] as never;

export interface OutageMapProps {
  geometry: OutageDetailDto['geometry'];
  // The person's house, when the address has a number that OSM knows.
  house: LngLatPoint | null;
  // The colour of the affected streets: the status colour of the outage.
  color: string;
  script: Script;
}

type Phase = 'loading' | 'ready' | 'failed';

/**
 * A small, still map of the affected streets: the base map from OpenFreeMap tiles in our palette, the
 * street geometry from our API drawn over it natively, the person's house marked. It never shows a blank
 * or broken map: while it loads there is a placeholder, and when the tiles do not arrive (no network, a
 * failing tile host, or no tile in view in time) it renders nothing, so the street list under it stands
 * alone. Nothing is downloaded for offline use.
 */
export function OutageMap({ geometry, house, color, script }: OutageMapProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const ref = useRef<MapRef>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [styleLoaded, setStyleLoaded] = useState(false);

  const shapes = useMemo(() => drawable(geometry), [geometry]);
  const bounds = useMemo(() => boundsOf(shapes, house), [shapes, house]);
  const style = useMemo(
    () => buildMapStyle(mapColors(theme.colors, theme.name), script),
    [theme.colors, theme.name, script],
  );
  const data = useMemo(() => ({ type: 'FeatureCollection' as const, features: shapes }), [shapes]);
  const houseData = useMemo(
    () =>
      house
        ? {
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'Point' as const, coordinates: [house.lng, house.lat] },
          }
        : null,
    [house],
  );

  // The tiles arrived when the base map has something in view; otherwise give up after the timeout.
  useEffect(() => {
    if (phase !== 'loading') return;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > MAP_CONFIG.timeoutMs) return setPhase('failed');
      if (!styleLoaded) return;
      try {
        const found = await ref.current?.queryRenderedFeatures({ layers: BASE_LAYER_IDS });
        if (found && found.length > 0) setPhase('ready');
      } catch {
        // not rendered yet; the next tick or the timeout decides
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [phase, styleLoaded]);

  if (!bounds || phase === 'failed') return null;

  const chrome = theme.colors.chrome;
  const lines = ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]] as const;
  const areas = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]] as const;
  const points = ['==', ['geometry-type'], 'Point'] as const;

  return (
    <View
      testID="outage-map"
      style={{
        height: MAP_HEIGHT,
        borderRadius: theme.radius.xl,
        overflow: 'hidden',
        backgroundColor: chrome.raised,
      }}
    >
      <View
        // a still picture: the street list under it is the accessible version
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{ flex: 1, opacity: phase === 'ready' ? 1 : 0 }}
      >
        <Map
          ref={ref}
          style={{ flex: 1 }}
          mapStyle={style}
          logo={false}
          attribution={false}
          compass={false}
          scaleBar={false}
          dragPan={false}
          touchZoom={false}
          doubleTapZoom={false}
          doubleTapHoldZoom={false}
          touchRotate={false}
          touchPitch={false}
          onDidFinishLoadingStyle={() => setStyleLoaded(true)}
          onDidFailLoadingMap={() => setPhase('failed')}
        >
          <Camera
            initialViewState={{
              bounds,
              padding: { top: 32, right: 32, bottom: 40, left: 32 },
            }}
            maxZoom={17}
          />
          <GeoJSONSource id="outage-shapes" data={data}>
            <Layer
              id="shape-area"
              type="fill"
              filter={areas as never}
              paint={{ 'fill-color': color, 'fill-opacity': 0.25 }}
            />
            <Layer
              id="shape-line-casing"
              type="line"
              filter={lines as never}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': chrome.card, 'line-width': lineWidth(4) }}
            />
            <Layer
              id="shape-line"
              type="line"
              filter={lines as never}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': color, 'line-width': lineWidth(0) }}
            />
            <Layer
              id="shape-point"
              type="circle"
              filter={points as never}
              paint={{
                'circle-radius': 26,
                'circle-color': color,
                'circle-opacity': 0.3,
                'circle-stroke-color': color,
                'circle-stroke-width': 2,
              }}
            />
          </GeoJSONSource>
          {houseData ? (
            <GeoJSONSource id="my-house" data={houseData}>
              <Layer
                id="my-house-halo"
                type="circle"
                paint={{
                  'circle-radius': 15,
                  'circle-color': chrome.accent,
                  'circle-opacity': 0.35,
                }}
              />
              <Layer
                id="my-house-dot"
                type="circle"
                paint={{
                  'circle-radius': 8,
                  'circle-color': chrome.accent,
                  'circle-stroke-color': chrome.onAccent,
                  'circle-stroke-width': 3,
                }}
              />
            </GeoJSONSource>
          ) : null}
        </Map>
      </View>

      {phase === 'loading' ? (
        <View
          accessible
          accessibilityLabel={t('state.loading')}
          style={{ position: 'absolute', inset: 0, backgroundColor: chrome.raised }}
        />
      ) : (
        // Always visible on the map, never behind a toggle: the OSM and OpenMapTiles credits.
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('detail.mapSource')}
          onPress={() => void Linking.openURL(MAP_CONFIG.attributionUrl)}
          style={{
            position: 'absolute',
            right: 6,
            bottom: 6,
            maxWidth: '92%',
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 8,
            backgroundColor: chrome.card,
            opacity: 0.92,
          }}
        >
          <AppText
            variant="label"
            color="textSecondary"
            maxFontSizeMultiplier={1.1}
            style={{ fontSize: 12, lineHeight: 16 }}
          >
            {MAP_CONFIG.attributionText}
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

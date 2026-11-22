import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  APILoadingStatus,
  AdvancedMarker,
  Circle,
  ColorScheme,
  InfoWindow,
  Map as GoogleMap,
  Polygon,
  useAdvancedMarkerRef,
  useApiIsLoaded,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {Columns2, Compass, Eye, Loader2, MapPin, Search, X} from 'lucide-react';
import type {
  AreaLayersToggle,
  Building,
  CityModel,
  EventState,
  HitBuilding,
  LocationPack,
  SeverityKey,
} from '../types/sara';
import {
  SEV,
  dronePos,
  fl,
  getBuildingRank,
  loc3,
  msgsAt,
} from '../sim/engine';
import {facadeSVG} from '../sim/renderers';
import {
  DEMO_MAP_ID,
  GMP_ATTRIBUTION_IDS,
  GOOGLE_MAPS_API_KEY,
  buildingFootprintLatLng,
  cityPtToLatLng,
  citySectorPolygon,
  dispatchQuotaExceeded,
  getLocationCenter,
} from '../lib/mapsConfig';

export interface SearchedPlaceResult {
  placeId?: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  viewport?: google.maps.LatLngBoundsLiteral | null;
}

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('QUOTA_EXCEEDED')
  );
}

function MapsGuardInner({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const status = useApiLoadingStatus();
  const isLoaded = useApiIsLoaded();

  if (status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) {
    return (
      fallback ?? (
        <div className="w-full h-full flex flex-col items-center justify-center p-5 text-center bg-[#0b0d0f] text-xs text-[#929ba2] gap-1.5">
          <span className="font-cond text-sm font-semibold text-[#ff9a3c]">
            Unable to load Google Maps tiles
          </span>
          <span>Check network connectivity, quota limits, or API key restrictions.</span>
        </div>
      )
    );
  }

  if (!isLoaded) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0b0d0f] text-xs text-[#929ba2]">
        Loading Google Maps Platform…
      </div>
    );
  }

  return <>{children}</>;
}

/** Shared status guard rendered inside Google Maps panes when key is absent or API failed. */
function MapsGuard({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  if (!GOOGLE_MAPS_API_KEY) {
    return (
      fallback ?? (
        <div className="w-full h-full flex flex-col items-center justify-center p-5 text-center bg-[#0b0d0f] text-xs text-[#929ba2] gap-1.5">
          <span className="font-cond text-sm font-semibold text-[#e7eaec]">
            Google Maps imagery unavailable
          </span>
          <span>API key not configured in this environment. Simulated layers remain active.</span>
        </div>
      )
    );
  }

  return <MapsGuardInner fallback={fallback}>{children}</MapsGuardInner>;
}

/** Smoothly pans/centers a map when target coordinates, zoom, or viewport change. */
function MapCameraSync({
  center,
  zoom,
  viewport,
  resetTrigger,
}: {
  center: google.maps.LatLngLiteral;
  zoom: number;
  viewport?: google.maps.LatLngBoundsLiteral | null;
  resetTrigger?: string | number;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    if (viewport) {
      map.fitBounds(viewport, 36);
    } else {
      map.setCenter(center);
      map.setZoom(zoom);
    }
  }, [map, center.lat, center.lng, zoom, viewport, resetTrigger]);
  return null;
}

/**
 * Modern Places API (New) address search bar using `AutocompleteSuggestion` +
 * `AutocompleteSessionToken` + `Place.fetchFields` + `Place.searchByText`.
 */
export function GoogleAddressSearchBar({
  onSelectPlace,
  placeholder = 'Search any street address, landmark, or city…',
  biasCenter,
  compact = false,
  className = '',
  initialQuery = '',
  id,
}: {
  onSelectPlace: (place: SearchedPlaceResult) => void;
  placeholder?: string;
  biasCenter?: google.maps.LatLngLiteral;
  compact?: boolean;
  className?: string;
  initialQuery?: string;
  id?: string;
}) {
  const placesLib = useMapsLibrary('places');
  const status = useApiLoadingStatus();
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<google.maps.places.PlacePrediction[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [notice, setNotice] = useState<string | null>(null);

  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  const ensureSessionToken = useCallback(() => {
    if (!placesLib) return null;
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new placesLib.AutocompleteSessionToken();
    }
    return sessionTokenRef.current;
  }, [placesLib]);

  const resetSessionToken = useCallback(() => {
    if (!placesLib) {
      sessionTokenRef.current = null;
      return;
    }
    sessionTokenRef.current = new placesLib.AutocompleteSessionToken();
  }, [placesLib]);

  // Debounced Places API (New) autocomplete suggestions
  useEffect(() => {
    if (!placesLib || !GOOGLE_MAPS_API_KEY) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setOpen(false);
      setNotice(null);
      return;
    }

    const myReqId = ++reqIdRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const token = ensureSessionToken();
        const request: google.maps.places.AutocompleteRequest = {
          input: trimmed,
          sessionToken: token ?? undefined,
          ...(biasCenter ? {origin: biasCenter} : {}),
        };
        const res = await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
        if (myReqId !== reqIdRef.current) return;
        const preds = (res.suggestions || [])
          .map((s) => s.placePrediction)
          .filter((p): p is google.maps.places.PlacePrediction => p != null);
        setSuggestions(preds);
        setHighlightIdx(-1);
        setOpen(preds.length > 0);
        setNotice(null);
      } catch (err: unknown) {
        if (myReqId !== reqIdRef.current) return;
        if (isQuotaError(err)) {
          dispatchQuotaExceeded();
          setNotice('Google Maps Places quota reached.');
        }
        setSuggestions([]);
      }
    }, 240);

    return () => window.clearTimeout(timer);
  }, [query, placesLib, biasCenter?.lat, biasCenter?.lng, ensureSessionToken]);

  const emitPlace = useCallback(
    (place: google.maps.places.Place, fallbackLabel?: string) => {
      const loc = place.location;
      if (!loc) {
        setNotice('Selected place has no map coordinates. Try a more specific street address.');
        return;
      }
      const lat = loc.lat();
      const lng = loc.lng();
      const formattedAddress =
        place.formattedAddress || place.displayName || fallbackLabel || query.trim();
      const name = place.displayName || formattedAddress.split(',')[0] || formattedAddress;
      const viewport = place.viewport ? place.viewport.toJSON() : null;

      setQuery(formattedAddress);
      setSuggestions([]);
      setOpen(false);
      setNotice(null);
      onSelectPlace({
        placeId: place.id,
        name,
        formattedAddress,
        lat,
        lng,
        viewport,
      });
    },
    [onSelectPlace, query]
  );

  const handleChoosePrediction = async (pred: google.maps.places.PlacePrediction) => {
    setBusy(true);
    setNotice(null);
    try {
      const place = pred.toPlace();
      await place.fetchFields({
        fields: ['id', 'displayName', 'formattedAddress', 'location', 'viewport'],
      });
      resetSessionToken();
      emitPlace(place, pred.text?.text);
    } catch (err: unknown) {
      if (isQuotaError(err)) {
        dispatchQuotaExceeded();
        setNotice('Google Maps Places quota reached.');
      } else {
        setNotice('Could not load details for that address.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (highlightIdx >= 0 && suggestions[highlightIdx]) {
      await handleChoosePrediction(suggestions[highlightIdx]);
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) return;
    if (!placesLib || !GOOGLE_MAPS_API_KEY) {
      setNotice('Google Maps Places library is still loading.');
      return;
    }

    // If dropdown already has a top prediction and user pressed Enter, fetch it or run searchByText
    setBusy(true);
    setNotice(null);
    setOpen(false);
    try {
      const {places} = await placesLib.Place.searchByText({
        textQuery: trimmed,
        fields: ['id', 'displayName', 'formattedAddress', 'location', 'viewport'],
        maxResultCount: 1,
        ...(biasCenter
          ? {
              locationBias: {
                center: biasCenter,
                radius: 25000,
              },
            }
          : {}),
      });
      resetSessionToken();
      if (!places || places.length === 0) {
        setNotice(`No Google Maps result found for "${trimmed}". Try adding city or country.`);
        return;
      }
      emitPlace(places[0], trimmed);
    } catch (err: unknown) {
      if (isQuotaError(err)) {
        dispatchQuotaExceeded();
        setNotice('Google Maps Places quota reached.');
      } else {
        setNotice('Address lookup failed. Check connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const mapsUnavailable =
    !GOOGLE_MAPS_API_KEY ||
    status === APILoadingStatus.FAILED ||
    status === APILoadingStatus.AUTH_FAILURE;

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0">
          <Search
            className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[#929ba2] pointer-events-none ${
              compact ? 'w-3.5 h-3.5' : 'w-4 h-4'
            }`}
          />
          <input
            id={id}
            type="text"
            value={query}
            disabled={mapsUnavailable}
            onFocus={() => {
              if (suggestions.length > 0) setOpen(true);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setNotice(null);
            }}
            onKeyDown={(e) => {
              if (!open || suggestions.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightIdx((i) => Math.min(suggestions.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIdx((i) => Math.max(-1, i - 1));
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            placeholder={
              mapsUnavailable ? 'Google Maps API key required for address search' : placeholder
            }
            autoComplete="off"
            aria-label="Search any address on Google Maps"
            className={`w-full bg-[#1b2024] border border-[#2c3338] rounded-md text-[#e7eaec] placeholder:text-[#929ba2]/75 focus-visible:outline-2 focus-visible:outline-[#45c4ea] disabled:opacity-50 ${
              compact
                ? 'min-h-[34px] pl-8 pr-7 py-1 text-xs'
                : 'min-h-[42px] pl-9 pr-8 py-2 text-sm'
            }`}
          />
          {query && !busy && (
            <button
              type="button"
              aria-label="Clear address search"
              onClick={() => {
                setQuery('');
                setSuggestions([]);
                setOpen(false);
                setNotice(null);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#929ba2] hover:text-white cursor-pointer p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {busy && (
            <Loader2 className="w-3.5 h-3.5 text-[#45c4ea] animate-spin absolute right-2 top-1/2 -translate-y-1/2" />
          )}
        </div>
        <button
          type="submit"
          disabled={busy || mapsUnavailable || !query.trim()}
          className={`shrink-0 rounded-md bg-[#232a2f] border border-[#45c4ea]/70 hover:border-[#45c4ea] hover:bg-[#2d3a42] text-[#e7eaec] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
            compact ? 'min-h-[34px] px-2.5 text-xs' : 'min-h-[42px] px-3.5 text-xs md:text-sm'
          }`}
        >
          Go
        </button>
      </form>

      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-40 max-h-64 overflow-y-auto rounded-md border border-[#2c3338] bg-[#15191c] shadow-2xl divide-y divide-[#22292e]"
        >
          {suggestions.map((pred, idx) => {
            const main = pred.mainText?.text || pred.text?.text || '';
            const secondary = pred.secondaryText?.text || '';
            const active = idx === highlightIdx;
            return (
              <li key={pred.placeId || idx}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void handleChoosePrediction(pred);
                  }}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2 cursor-pointer transition-colors ${
                    active ? 'bg-[#2d3a42] text-white' : 'hover:bg-[#1b2024] text-[#e7eaec]'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5 text-[#45c4ea] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{main}</div>
                    {secondary && (
                      <div className="text-[11px] text-[#929ba2] truncate">{secondary}</div>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {notice && (
        <div className="mt-1 px-2.5 py-1 rounded bg-[#15191c]/95 border border-[#ff9a3c]/50 text-[11px] text-[#ffbe80]">
          {notice}
        </div>
      )}
    </div>
  );
}

/**
 * Interactive Google Street View Panorama for any lat/lng coordinate or Building.
 */
export function CoordinatesStreetView({
  lat,
  lng,
  heading = 0,
  label,
  fallbackBuilding,
}: {
  lat: number;
  lng: number;
  heading?: number;
  label?: string;
  fallbackBuilding?: Building;
}) {
  const streetViewLib = useMapsLibrary('streetView');
  const status = useApiLoadingStatus();
  const panoHostRef = useRef<HTMLDivElement | null>(null);
  const [svState, setSvState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [panoInfo, setPanoInfo] = useState<{
    panoId: string;
    date?: string;
    description?: string;
  } | null>(null);

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) {
      setSvState('unavailable');
      return;
    }
    if (!streetViewLib || !panoHostRef.current) {
      setSvState('loading');
      return;
    }

    let cancelled = false;
    let panoInstance: google.maps.StreetViewPanorama | null = null;
    setSvState('loading');
    setPanoInfo(null);

    const svService = new streetViewLib.StreetViewService();
    const target = {lat, lng};

    const loadPanorama = async () => {
      try {
        let res: google.maps.StreetViewResponse | null = null;
        try {
          res = await svService.getPanorama({
            location: target,
            radius: 150,
            preference: streetViewLib.StreetViewPreference.NEAREST,
            sources: [streetViewLib.StreetViewSource.OUTDOOR],
          });
        } catch (err: unknown) {
          if (isQuotaError(err)) {
            dispatchQuotaExceeded();
            if (!cancelled) setSvState('unavailable');
            return;
          }
          try {
            res = await svService.getPanorama({
              location: target,
              radius: 600,
              preference: streetViewLib.StreetViewPreference.NEAREST,
            });
          } catch (retryErr: unknown) {
            if (isQuotaError(retryErr)) {
              dispatchQuotaExceeded();
              if (!cancelled) setSvState('unavailable');
              return;
            }
            try {
              res = await svService.getPanorama({
                location: target,
                radius: 1500,
                preference: streetViewLib.StreetViewPreference.BEST,
              });
            } catch (wideErr: unknown) {
              if (isQuotaError(wideErr)) {
                dispatchQuotaExceeded();
              }
              res = null;
            }
          }
        }

        if (cancelled || !panoHostRef.current) return;

        const panoId = res?.data?.location?.pano;
        if (!panoId) {
          setSvState('unavailable');
          return;
        }

        panoInstance = new streetViewLib.StreetViewPanorama(panoHostRef.current, {
          pano: panoId,
          pov: {
            heading,
            pitch: 4,
          },
          zoom: 1,
          addressControl: true,
          linksControl: true,
          panControl: true,
          zoomControl: true,
          enableCloseButton: false,
          motionTracking: false,
          motionTrackingControl: false,
        });

        setPanoInfo({
          panoId,
          date: res?.data?.imageDate,
          description:
            (res?.data?.location?.description || res?.data?.location?.shortDescription) ??
            undefined,
        });
        setSvState('ready');
      } catch (e: unknown) {
        if (isQuotaError(e)) {
          dispatchQuotaExceeded();
        }
        if (!cancelled) setSvState('unavailable');
      }
    };

    void loadPanorama();

    return () => {
      cancelled = true;
      if (panoInstance) {
        panoInstance.setVisible(false);
        panoInstance = null;
      }
      if (panoHostRef.current) {
        panoHostRef.current.innerHTML = '';
      }
    };
  }, [streetViewLib, status, lat, lng, heading]);

  return (
    <div className="w-full h-full relative bg-[#0b0d0f]">
      <div
        ref={panoHostRef}
        className={`w-full h-full ${svState === 'ready' ? 'block' : 'hidden'}`}
      />

      {svState === 'loading' && (
        <div className="w-full h-full flex flex-col items-center justify-center text-xs text-[#929ba2] gap-1.5 p-4 text-center">
          <Loader2 className="w-4 h-4 text-[#45c4ea] animate-spin" />
          <span>Connecting to Google Street View…</span>
          <span className="font-mono-tab text-[11px]">
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </span>
        </div>
      )}

      {svState === 'unavailable' &&
        (fallbackBuilding ? (
          <div className="w-full h-full relative">
            <svg
              viewBox="0 0 400 240"
              preserveAspectRatio="xMidYMid slice"
              className="w-full h-full block"
              dangerouslySetInnerHTML={{__html: facadeSVG(fallbackBuilding, 400, 240, true)}}
            />
            <div className="absolute bottom-2 left-2 right-2 z-10 px-2.5 py-1 rounded bg-[#0a0c0e]/90 border border-[#2c3338] text-[11px] text-[#929ba2]">
              No outdoor Google Street View panorama at this offset — simulated facade shown.
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-5 text-center gap-2 bg-[#0b0d0f]">
            <Compass className="w-5 h-5 text-[#929ba2]" />
            <div className="text-xs font-medium text-[#e7eaec]">
              No Street View panorama within 1.5 km
            </div>
            <div className="text-[11px] text-[#929ba2] max-w-xs">
              Click a street or search another address on Google Maps to inspect nearby Street View coverage.
            </div>
          </div>
        ))}

      {svState === 'ready' && panoInfo && (
        <div className="absolute bottom-2 left-2 z-10 pointer-events-none px-2 py-0.5 rounded bg-[#0a0c0e]/85 border border-[#2c3338] text-[10px] text-[#e7eaec] font-mono-tab max-w-[80%] truncate">
          Street View{panoInfo.date ? ` · ${panoInfo.date}` : ''}
          {label || panoInfo.description ? ` · ${label || panoInfo.description}` : ''}
        </div>
      )}
    </div>
  );
}

/** Step 1 sector preview map centered on the selected/searched location with Map, Street View, or Split view. */
export function CommandLocationPreviewMap({
  loc,
  satellite,
  searchedPin,
}: {
  loc: LocationPack;
  satellite: boolean;
  searchedPin?: SearchedPlaceResult | null;
}) {
  const center = useMemo(() => getLocationCenter(loc), [loc]);
  const sectorPoly = useMemo(() => citySectorPolygon(loc), [loc]);
  const [viewMode, setViewMode] = useState<'map' | 'split' | 'sv'>('map');
  const [mapStyle, setMapStyle] = useState<'hybrid' | 'roadmap'>(satellite ? 'hybrid' : 'roadmap');
  const [svCoords, setSvCoords] = useState<{lat: number; lng: number; label: string}>({
    lat: center.lat,
    lng: center.lng,
    label: loc.name,
  });

  useEffect(() => {
    setMapStyle(satellite ? 'hybrid' : 'roadmap');
  }, [satellite]);

  useEffect(() => {
    setSvCoords({
      lat: searchedPin?.lat ?? center.lat,
      lng: searchedPin?.lng ?? center.lng,
      label: searchedPin?.formattedAddress || loc.name,
    });
  }, [center.lat, center.lng, loc.name, searchedPin?.lat, searchedPin?.lng, searchedPin?.formattedAddress]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex border border-[#2c3338] rounded-md overflow-hidden bg-[#1b2024]">
          {(
            [
              ['map', 'Map'],
              ['split', 'Map + Street View'],
              ['sv', 'Street View'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`min-h-[32px] px-2.5 text-xs font-medium border-r last:border-r-0 border-[#2c3338] cursor-pointer flex items-center gap-1.5 ${
                viewMode === mode
                  ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                  : 'text-[#e7eaec] hover:bg-[#232a2f]'
              }`}
            >
              {mode === 'split' && <Columns2 className="w-3.5 h-3.5 text-[#45c4ea]" />}
              {mode === 'sv' && <Eye className="w-3.5 h-3.5 text-[#45c4ea]" />}
              {label}
            </button>
          ))}
        </div>

        {viewMode !== 'sv' && (
          <div className="inline-flex border border-[#2c3338] rounded-md overflow-hidden bg-[#1b2024]">
            <button
              type="button"
              onClick={() => setMapStyle('roadmap')}
              className={`min-h-[32px] px-2.5 text-xs border-r border-[#2c3338] cursor-pointer ${
                mapStyle === 'roadmap'
                  ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                  : 'text-[#929ba2] hover:text-white'
              }`}
            >
              Roads
            </button>
            <button
              type="button"
              onClick={() => setMapStyle('hybrid')}
              className={`min-h-[32px] px-2.5 text-xs cursor-pointer ${
                mapStyle === 'hybrid'
                  ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                  : 'text-[#929ba2] hover:text-white'
              }`}
            >
              Satellite
            </button>
          </div>
        )}
      </div>

      <div
        className={`w-full rounded-md overflow-hidden border border-[#2c3338] bg-[#0b0d0f] grid ${
          viewMode === 'split'
            ? 'grid-cols-1 md:grid-cols-2 h-[440px] md:h-[290px]'
            : 'grid-cols-1 h-[260px] md:h-[290px]'
        }`}
      >
        {viewMode !== 'sv' && (
          <div className="relative w-full h-full min-h-[200px]">
            <MapsGuard>
              <GoogleMap
                mapId={DEMO_MAP_ID}
                internalUsageAttributionIds={GMP_ATTRIBUTION_IDS}
                defaultCenter={center}
                defaultZoom={16}
                mapTypeId={mapStyle}
                colorScheme={mapStyle === 'roadmap' ? ColorScheme.DARK : undefined}
                gestureHandling="cooperative"
                mapTypeControl={false}
                fullscreenControl={false}
                streetViewControl
                zoomControl
                onClick={(e) => {
                  const ll = e.detail.latLng;
                  if (!ll) return;
                  setSvCoords({
                    lat: ll.lat,
                    lng: ll.lng,
                    label: `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`,
                  });
                }}
                className="w-full h-full"
              >
                <MapCameraSync
                  center={center}
                  zoom={searchedPin ? 17 : 15}
                  viewport={searchedPin?.viewport ?? null}
                  resetTrigger={loc.id}
                />
                <Polygon
                  paths={sectorPoly}
                  strokeColor="#45c4ea"
                  strokeOpacity={0.9}
                  strokeWeight={2}
                  fillColor="#45c4ea"
                  fillOpacity={0.12}
                  clickable={false}
                />
                <AdvancedMarker position={center} title={`${loc.name} · 600 × 400 m sector`}>
                  <div className="px-2 py-0.5 rounded bg-[#0a0c0e]/90 border border-[#45c4ea] text-[10px] font-semibold text-[#e7eaec] shadow max-w-[180px] truncate">
                    {searchedPin?.name || loc.city}
                  </div>
                </AdvancedMarker>
                {(svCoords.lat !== center.lat || svCoords.lng !== center.lng) && (
                  <AdvancedMarker position={{lat: svCoords.lat, lng: svCoords.lng}} title="Street View pin">
                    <div className="w-3.5 h-3.5 rounded-full bg-[#f5c23e] border-2 border-[#0a0c0e] shadow" />
                  </AdvancedMarker>
                )}
              </GoogleMap>
            </MapsGuard>
            <div className="absolute bottom-1.5 left-1.5 z-10 pointer-events-none px-2 py-0.5 rounded bg-[#0a0c0e]/85 border border-[#2c3338] text-[10px] text-[#929ba2]">
              Click map or drag Pegman for Street View · 600 × 400 m sector
            </div>
          </div>
        )}

        {viewMode !== 'map' && (
          <div
            className={`relative w-full h-full min-h-[200px] ${
              viewMode === 'split' ? 'border-t md:border-t-0 md:border-l border-[#2c3338]' : ''
            }`}
          >
            <CoordinatesStreetView
              lat={svCoords.lat}
              lng={svCoords.lng}
              label={svCoords.label}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Step 2 interactive Google Satellite map allowing direct selection of simulated sector buildings. */
export function CommandStep2GoogleMap({
  loc,
  city,
  selectedIds,
  poly,
  polyClosed,
  onToggleBuilding,
}: {
  loc: LocationPack;
  city: CityModel;
  selectedIds: Record<number, SeverityKey>;
  poly: [number, number][];
  polyClosed: boolean;
  onToggleBuilding: (id: number) => void;
}) {
  const center = useMemo(() => getLocationCenter(loc), [loc]);
  const polyLatLng = useMemo(
    () => poly.map(([x, y]) => cityPtToLatLng(loc, x, y)),
    [loc, poly]
  );

  return (
    <div className="w-full h-full relative bg-[#0b0d0f]">
      <MapsGuard>
        <GoogleMap
          mapId={DEMO_MAP_ID}
          internalUsageAttributionIds={GMP_ATTRIBUTION_IDS}
          defaultCenter={center}
          defaultZoom={17}
          mapTypeId="hybrid"
          gestureHandling="greedy"
          mapTypeControl={false}
          fullscreenControl={false}
          streetViewControl
          zoomControl
          className="w-full h-full"
        >
          <MapCameraSync center={center} zoom={17} resetTrigger={loc.id} />

          {polyClosed && polyLatLng.length >= 3 && (
            <Polygon
              paths={polyLatLng}
              strokeColor="#ff6a2b"
              strokeOpacity={0.95}
              strokeWeight={2.5}
              fillColor="#ff6a2b"
              fillOpacity={0.14}
            />
          )}

          {city.bl.map((b) => {
            const sev = selectedIds[b.id];
            const pos = cityPtToLatLng(loc, b.cx, b.cy);
            if (sev) {
              return (
                <AdvancedMarker
                  key={b.id}
                  position={pos}
                  title={`${b.addr} (${SEV[sev].n}) — click to unmark`}
                  onClick={() => onToggleBuilding(b.id)}
                  zIndex={20}
                >
                  <button
                    type="button"
                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-[#0a0c0e] border border-white/80 shadow cursor-pointer whitespace-nowrap"
                    style={{backgroundColor: SEV[sev].col}}
                  >
                    {b.addr}
                  </button>
                </AdvancedMarker>
              );
            }
            return (
              <AdvancedMarker
                key={b.id}
                position={pos}
                title={`${b.addr} · ${b.floors}F — click to mark`}
                onClick={() => onToggleBuilding(b.id)}
                zIndex={5}
              >
                <button
                  type="button"
                  aria-label={`Mark ${b.addr}`}
                  className="w-3 h-3 rounded-full bg-[#15191c]/85 border border-[#e7eaec]/80 hover:scale-125 hover:border-[#ff6a2b] transition-transform cursor-pointer"
                />
              </AdvancedMarker>
            );
          })}
        </GoogleMap>
      </MapsGuard>
    </div>
  );
}

interface HitMarkerProps {
  ev: EventState;
  h: HitBuilding;
  b: Building;
  t: number;
  selected: boolean;
  onSelect: (id: number, marker: google.maps.marker.AdvancedMarkerElement | null) => void;
}

function HitBuildingMarker({ev, h, b, t, selected, onSelect}: HitMarkerProps) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const rank = getBuildingRank(ev, h.id);
  const pos = useMemo(() => cityPtToLatLng(ev.loc, b.cx, b.cy), [ev.loc, b.cx, b.cy]);
  const sevCol = SEV[h.sev].col;
  const phones3d = h.dev.filter((d) => loc3(d, t)).length;

  return (
    <AdvancedMarker
      ref={markerRef}
      position={pos}
      title={`${b.addr} · ${SEV[h.sev].n}`}
      onClick={() => onSelect(h.id, marker)}
      zIndex={selected ? 50 : rank != null ? 40 - rank : 15}
    >
      <div
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded border shadow-lg cursor-pointer transition-transform ${
          selected ? 'scale-110 ring-2 ring-white' : 'hover:scale-105'
        }`}
        style={{
          backgroundColor: '#111619e8',
          borderColor: sevCol,
        }}
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{backgroundColor: sevCol}}
        />
        <span className="font-cond text-[11px] font-bold text-white whitespace-nowrap">
          {rank != null ? `#${rank}` : '—'}
        </span>
        <span className="text-[10.5px] font-medium text-[#e7eaec] max-w-[95px] truncate">
          {b.addr}
        </span>
        {phones3d > 0 && (
          <span className="text-[10px] font-semibold text-[#ff8fc8] tabular-nums">
            {phones3d}p
          </span>
        )}
      </div>
    </AdvancedMarker>
  );
}

/** Area View Google Maps viewport with address search, interactive Street View drawer, building markers, polygon, IMSI points, and drones. */
export function GoogleAreaMap({
  ev,
  t,
  layers,
  onOpenBuilding,
}: {
  ev: EventState;
  t: number;
  layers: AreaLayersToggle;
  onOpenBuilding: (id: number) => void;
}) {
  const [baseType, setBaseType] = useState<'hybrid' | 'satellite' | 'roadmap'>('hybrid');
  const [activeId, setActiveId] = useState<number | null>(null);
  const [activeMarker, setActiveMarker] =
    useState<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [resetNonce, setResetNonce] = useState(0);

  const [searchPin, setSearchPin] = useState<SearchedPlaceResult | null>(null);
  const [searchMarkerRef, searchMarker] = useAdvancedMarkerRef();
  const [searchInfoOpen, setSearchInfoOpen] = useState(false);

  const [svTarget, setSvTarget] = useState<{lat: number; lng: number; label: string} | null>(null);
  const [svOpen, setSvOpen] = useState(false);

  const sectorCenter = useMemo(
    () => cityPtToLatLng(ev.loc, ev.cx, ev.cy),
    [ev.loc, ev.cx, ev.cy]
  );

  const cameraTarget = useMemo(() => {
    if (searchPin) {
      return {
        center: {lat: searchPin.lat, lng: searchPin.lng},
        zoom: 17,
        viewport: searchPin.viewport ?? null,
      };
    }
    return {
      center: sectorCenter,
      zoom: 17,
      viewport: null,
    };
  }, [searchPin, sectorCenter]);

  const polyPaths = useMemo(() => {
    if (!ev.poly || ev.poly.length < 3) return null;
    return ev.poly.map(([x, y]) => cityPtToLatLng(ev.loc, x, y));
  }, [ev.loc, ev.poly]);

  const activeDrones = useMemo(() => dronePos(ev, t), [ev, t]);

  const activeHit = activeId != null ? ev.H[activeId] : null;
  const activeB = activeId != null ? ev.city.bl[activeId] : null;

  const openStreetViewAt = (lat: number, lng: number, label: string) => {
    setSvTarget({lat, lng, label});
    setSvOpen(true);
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#0b0d0f] relative">
      <div className={`relative w-full min-h-0 ${svOpen ? 'flex-[3]' : 'flex-1'}`}>
        <MapsGuard>
          <GoogleMap
            mapId={DEMO_MAP_ID}
            internalUsageAttributionIds={GMP_ATTRIBUTION_IDS}
            defaultCenter={sectorCenter}
            defaultZoom={17}
            mapTypeId={baseType}
            colorScheme={baseType === 'roadmap' ? ColorScheme.DARK : undefined}
            gestureHandling="greedy"
            mapTypeControl={false}
            fullscreenControl={false}
            streetViewControl
            zoomControl
            onClick={(e) => {
              setActiveId(null);
              setActiveMarker(null);
              setSearchInfoOpen(false);
              if (svOpen && e.detail.latLng) {
                const {lat, lng} = e.detail.latLng;
                setSvTarget({
                  lat,
                  lng,
                  label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                });
              }
            }}
            className="w-full h-full"
          >
            <MapCameraSync
              center={cameraTarget.center}
              zoom={cameraTarget.zoom}
              viewport={cameraTarget.viewport}
              resetTrigger={`${ev.loc.id}-${resetNonce}-${searchPin?.lat ?? ''}-${searchPin?.lng ?? ''}`}
            />

            {/* Event area polygon */}
            {layers.poly && polyPaths && (
              <Polygon
                paths={polyPaths}
                strokeColor="#ff6a2b"
                strokeOpacity={0.9}
                strokeWeight={2}
                fillColor="#ff6a2b"
                fillOpacity={0.12}
                clickable={false}
              />
            )}

            {/* Building footprints for hit buildings when damage outline layer is active */}
            {layers.dmg &&
              ev.hits.map((h) => {
                const b = ev.city.bl[h.id];
                return (
                  <Polygon
                    key={`fp-${h.id}`}
                    paths={buildingFootprintLatLng(ev.loc, b)}
                    strokeColor={SEV[h.sev].col}
                    strokeOpacity={0.95}
                    strokeWeight={2}
                    fillColor={SEV[h.sev].col}
                    fillOpacity={0.28}
                    clickable={false}
                  />
                );
              })}

            {/* Hit building interactive markers */}
            {ev.hits.map((h) => {
              const b = ev.city.bl[h.id];
              return (
                <HitBuildingMarker
                  key={h.id}
                  ev={ev}
                  h={h}
                  b={b}
                  t={t}
                  selected={activeId === h.id}
                  onSelect={(id, marker) => {
                    setActiveId(id);
                    setActiveMarker(marker);
                    setSearchInfoOpen(false);
                  }}
                />
              );
            })}

            {/* Searched address pin */}
            {searchPin && (
              <AdvancedMarker
                ref={searchMarkerRef}
                position={{lat: searchPin.lat, lng: searchPin.lng}}
                title={searchPin.formattedAddress}
                onClick={() => {
                  setActiveId(null);
                  setActiveMarker(null);
                  setSearchInfoOpen(true);
                }}
                zIndex={60}
              >
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#0b1f29]/95 border-2 border-[#45c4ea] text-[11px] font-semibold text-white shadow-xl">
                  <MapPin className="w-3.5 h-3.5 text-[#45c4ea]" />
                  <span className="max-w-[140px] truncate">{searchPin.name}</span>
                </div>
              </AdvancedMarker>
            )}

            {searchPin && searchInfoOpen && searchMarker && (
              <InfoWindow
                anchor={searchMarker}
                onCloseClick={() => setSearchInfoOpen(false)}
                maxWidth={270}
              >
                <div className="text-[#111] text-xs space-y-1.5 p-0.5">
                  <div className="font-semibold text-sm">{searchPin.name}</div>
                  <div className="text-slate-600">{searchPin.formattedAddress}</div>
                  <div className="flex gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        openStreetViewAt(
                          searchPin.lat,
                          searchPin.lng,
                          searchPin.formattedAddress
                        )
                      }
                      className="flex-1 px-2.5 py-1.5 rounded bg-[#0e7490] text-white font-semibold text-xs cursor-pointer"
                    >
                      Open Street View
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchPin(null);
                        setSearchInfoOpen(false);
                        setResetNonce((n) => n + 1);
                      }}
                      className="px-2 py-1.5 rounded bg-slate-200 text-slate-800 font-medium text-xs cursor-pointer"
                    >
                      Sector
                    </button>
                  </div>
                </div>
              </InfoWindow>
            )}

            {/* 3D-located phones (Phase 2 · Simulated) */}
            {layers.imsi &&
              ev.hits.flatMap((h) => {
                const b = ev.city.bl[h.id];
                return h.dev
                  .filter((d) => loc3(d, t))
                  .map((d) => {
                    const px = b.x + d.fx * b.w;
                    const py = b.y + d.fy * b.h;
                    return (
                      <AdvancedMarker
                        key={`ph-${h.id}-${d.k}`}
                        position={cityPtToLatLng(ev.loc, px, py)}
                        title={`Simulated Phase 2 phone P${d.k + 1} · Floor ${fl(d.floor)}`}
                        zIndex={25}
                      >
                        <div className="w-2.5 h-2.5 rounded-full bg-[#ff3fa4] border border-white shadow" />
                      </AdvancedMarker>
                    );
                  });
              })}

            {/* Active Drones */}
            {layers.drone &&
              activeDrones.map((d) => {
                const dPos = cityPtToLatLng(ev.loc, d.x, d.y);
                const orbB = d.b != null ? ev.city.bl[d.b] : null;
                return (
                  <React.Fragment key={`dr-${d.id}`}>
                    {d.a === 'orb' && orbB && (
                      <Circle
                        center={cityPtToLatLng(ev.loc, orbB.cx, orbB.cy)}
                        radius={(d.r ?? 30) * 0.5}
                        strokeColor="#45c4ea"
                        strokeOpacity={0.85}
                        strokeWeight={1.5}
                        fillOpacity={0}
                        clickable={false}
                      />
                    )}
                    <AdvancedMarker
                      position={dPos}
                      title={`Drone ${d.id} (simulated)`}
                      zIndex={35}
                    >
                      <div className="px-1.5 py-0.5 rounded bg-[#0b1f29]/95 border border-[#45c4ea] text-[10px] font-cond font-bold text-[#45c4ea] shadow">
                        {d.id}
                      </div>
                    </AdvancedMarker>
                  </React.Fragment>
                );
              })}

            {/* InfoWindow for clicked hit building */}
            {activeHit && activeB && activeMarker && (
              <InfoWindow
                anchor={activeMarker}
                onCloseClick={() => {
                  setActiveId(null);
                  setActiveMarker(null);
                }}
                maxWidth={270}
              >
                <div className="text-[#111] text-xs space-y-1.5 p-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{activeB.addr}</strong>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300">
                      Simulated
                    </span>
                  </div>
                  <div className="text-slate-700">
                    {SEV[activeHit.sev].n} ·{' '}
                    {getBuildingRank(ev, activeHit.id) != null
                      ? `Priority #${getBuildingRank(ev, activeHit.id)}`
                      : 'Not ranked'}
                  </div>
                  <div className="text-slate-600">
                    {activeB.floors} floors · {activeB.units} flats ·{' '}
                    {activeHit.dev.filter((d) => loc3(d, t)).length} phones 3D ·{' '}
                    {msgsAt(ev, t, activeHit.id).length} reports
                  </div>
                  {ev.team[activeHit.id] && (
                    <div className="text-slate-700 font-medium">
                      Team: {ev.team[activeHit.id]}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => onOpenBuilding(activeHit.id)}
                      className="px-2 py-1.5 rounded bg-[#ff6a2b] text-[#160800] font-semibold text-xs cursor-pointer"
                    >
                      Open file →
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const pt = cityPtToLatLng(ev.loc, activeB.cx, activeB.cy);
                        openStreetViewAt(pt.lat, pt.lng, activeB.addr);
                      }}
                      className="px-2 py-1.5 rounded bg-[#1e293b] text-white font-semibold text-xs cursor-pointer"
                    >
                      Street View
                    </button>
                  </div>
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
        </MapsGuard>

        {/* Address Search + Base map type + Street View controls */}
        <div className="absolute left-2.5 right-2.5 top-14 z-10 flex flex-col gap-1.5 pointer-events-none">
          <div className="pointer-events-auto max-w-md w-full bg-[#0a0c0e]/90 p-1.5 rounded-md border border-[#2c3338] shadow-lg">
            <GoogleAddressSearchBar
              compact
              biasCenter={sectorCenter}
              placeholder="Search any address or place on Google Maps…"
              onSelectPlace={(place) => {
                setSearchPin(place);
                setSearchInfoOpen(true);
                setSvTarget({
                  lat: place.lat,
                  lng: place.lng,
                  label: place.formattedAddress,
                });
              }}
            />
          </div>

          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 w-fit">
            <div className="inline-flex border border-[#2c3338] rounded-md overflow-hidden bg-[#1b2024]/95 shadow">
              {(
                [
                  ['hybrid', 'Hybrid'],
                  ['satellite', 'Satellite'],
                  ['roadmap', 'Roads'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setBaseType(mode)}
                  className={`min-h-[32px] px-2.5 text-xs font-medium border-r last:border-r-0 border-[#2c3338] cursor-pointer ${
                    baseType === mode
                      ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                      : 'text-[#e7eaec] hover:bg-[#232a2f]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                setSearchPin(null);
                setSearchInfoOpen(false);
                setResetNonce((n) => n + 1);
              }}
              className="min-h-[32px] px-2.5 rounded-md bg-[#1b2024]/95 border border-[#2c3338] hover:border-[#45c4ea] text-xs text-[#e7eaec] cursor-pointer shadow"
            >
              Fit sector
            </button>

            <button
              type="button"
              onClick={() => {
                if (svOpen) {
                  setSvOpen(false);
                } else {
                  const target = searchPin
                    ? {lat: searchPin.lat, lng: searchPin.lng, label: searchPin.formattedAddress}
                    : {lat: sectorCenter.lat, lng: sectorCenter.lng, label: ev.loc.name};
                  setSvTarget(svTarget || target);
                  setSvOpen(true);
                }
              }}
              className={`min-h-[32px] px-2.5 rounded-md border text-xs font-medium cursor-pointer shadow flex items-center gap-1.5 ${
                svOpen
                  ? 'bg-[#2d3a42] border-[#45c4ea] text-white'
                  : 'bg-[#1b2024]/95 border-[#2c3338] hover:border-[#45c4ea] text-[#e7eaec]'
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-[#45c4ea]" />
              {svOpen ? 'Hide Street View' : 'Street View'}
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Split Street View Drawer */}
      {svOpen && svTarget && (
        <div className="flex-[2] min-h-[190px] border-t border-[#45c4ea]/60 bg-[#0b0d0f] flex flex-col">
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[#15191c] border-b border-[#2c3338] text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Eye className="w-3.5 h-3.5 text-[#45c4ea] shrink-0" />
              <span className="font-semibold text-[#e7eaec] truncate">
                Street View · {svTarget.label}
              </span>
              <span className="text-[11px] text-[#929ba2] hidden sm:inline">
                (Click anywhere on map to move Street View)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSvOpen(false)}
              aria-label="Close Street View"
              className="min-h-[26px] px-2 rounded bg-[#232a2f] border border-[#2c3338] text-[#e7eaec] hover:border-[#45c4ea] cursor-pointer text-[11px]"
            >
              Close
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <CoordinatesStreetView
              lat={svTarget.lat}
              lng={svTarget.lng}
              label={svTarget.label}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Building File Pane 3: Zoomed Google Maps view of the target building & neighboring hit buildings. */
export function GoogleBuildingLocationMap({
  ev,
  bid,
  onOpenBuilding,
}: {
  ev: EventState;
  bid: number;
  onOpenBuilding: (id: number) => void;
}) {
  const [mapType, setMapType] = useState<'hybrid' | 'roadmap'>('hybrid');
  const targetB = ev.city.bl[bid];
  const center = useMemo(
    () => cityPtToLatLng(ev.loc, targetB.cx, targetB.cy),
    [ev.loc, targetB.cx, targetB.cy]
  );

  return (
    <div className="w-full h-full relative bg-[#0b0d0f]">
      <MapsGuard>
        <GoogleMap
          mapId={DEMO_MAP_ID}
          internalUsageAttributionIds={GMP_ATTRIBUTION_IDS}
          defaultCenter={center}
          defaultZoom={18}
          mapTypeId={mapType}
          colorScheme={mapType === 'roadmap' ? ColorScheme.DARK : undefined}
          gestureHandling="greedy"
          mapTypeControl={false}
          fullscreenControl={false}
          streetViewControl
          zoomControl
          className="w-full h-full"
        >
          <MapCameraSync center={center} zoom={18} resetTrigger={`${ev.loc.id}-${bid}`} />

          <Circle
            center={center}
            radius={35}
            strokeColor="#ff6a2b"
            strokeOpacity={0.85}
            strokeWeight={1.5}
            fillColor="#ff6a2b"
            fillOpacity={0.08}
            clickable={false}
          />

          {ev.hits.map((other) => {
            const ob = ev.city.bl[other.id];
            const isTarget = other.id === bid;
            const pos = cityPtToLatLng(ev.loc, ob.cx, ob.cy);
            const rank = getBuildingRank(ev, other.id);
            return (
              <AdvancedMarker
                key={other.id}
                position={pos}
                title={`${ob.addr} · ${SEV[other.sev].n}`}
                onClick={() => {
                  if (!isTarget) onOpenBuilding(other.id);
                }}
                zIndex={isTarget ? 40 : 10}
              >
                <div
                  className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold shadow whitespace-nowrap ${
                    isTarget
                      ? 'bg-[#ff6a2b] text-[#160800] border-white cursor-default'
                      : 'bg-[#15191c]/90 text-[#e7eaec] hover:border-white cursor-pointer'
                  }`}
                  style={isTarget ? undefined : {borderColor: SEV[other.sev].col}}
                >
                  {rank != null ? `#${rank} ` : ''}
                  {ob.addr}
                </div>
              </AdvancedMarker>
            );
          })}
        </GoogleMap>
      </MapsGuard>

      <div className="absolute top-2 right-2 z-10 inline-flex border border-[#2c3338] rounded-md overflow-hidden bg-[#1b2024]/95">
        <button
          type="button"
          onClick={() => setMapType('hybrid')}
          className={`min-h-[28px] px-2 text-[11px] border-r border-[#2c3338] cursor-pointer ${
            mapType === 'hybrid'
              ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
              : 'text-[#e7eaec]'
          }`}
        >
          Satellite
        </button>
        <button
          type="button"
          onClick={() => setMapType('roadmap')}
          className={`min-h-[28px] px-2 text-[11px] cursor-pointer ${
            mapType === 'roadmap'
              ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
              : 'text-[#e7eaec]'
          }`}
        >
          Map
        </button>
      </div>
    </div>
  );
}

/**
 * Building File Pane 5: Interactive Google Street View Panorama via Maps JS `streetView` library.
 * Gracefully falls back to the simulated street-level facade if key is missing or Street View coverage is unavailable.
 */
export function GoogleStreetViewPane({
  ev,
  b,
}: {
  ev: EventState;
  b: Building;
}) {
  const targetPos = useMemo(
    () => cityPtToLatLng(ev.loc, b.cx, b.cy),
    [ev.loc, b.cx, b.cy]
  );

  return (
    <CoordinatesStreetView
      lat={targetPos.lat}
      lng={targetPos.lng}
      heading={(b.id * 47) % 360}
      label={b.addr}
      fallbackBuilding={b}
    />
  );
}

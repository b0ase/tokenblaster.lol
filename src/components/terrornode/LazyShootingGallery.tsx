'use client';
import dynamic from 'next/dynamic';
import { EngineLoading } from './EngineLoading';

/**
 * The ShootingGallery engine (three.js, models, game code) as its own chunk, loaded in the browser behind the
 * loading card (29 Oct audit: the route shipped 3.19 MB of JS before anything showed). The home page prefetches it.
 */
export const loadShootingGallery = () => import('@/components/gallery/ShootingGallery').then((m) => m.ShootingGallery);
export const LazyShootingGallery = dynamic(loadShootingGallery, { ssr: false, loading: () => <EngineLoading /> });

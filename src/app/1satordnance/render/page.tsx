import { OrdnanceRender } from '@/components/OrdnanceRender';

export const metadata = { title: 'Render · 1Sat Ordnance', robots: { index: false } };

/** DEV ONLY: renders every weapon's poster card + share image into public/ordnance/cards/. */
export default function RenderPage() {
  return <OrdnanceRender />;
}

import dynamic from 'next/dynamic';

const WorldMapLibre = dynamic(() => import('@/components/WorldMapLibre'), { ssr: false });

export default function Home() {
  return (
    <main className="w-full h-screen">
      <WorldMapLibre />
    </main>
  );
}

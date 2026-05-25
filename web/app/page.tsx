import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-md">

        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-strava rounded-xl flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
              <path d="M13.5 3L9 14h3.5L8.5 21l9-11h-4.5z"/>
            </svg>
          </div>
          <span className="text-2xl font-semibold tracking-tight">SegmentIQ</span>
        </div>

        {/* Tagline */}
        <p className="text-text-secondary text-sm mb-10 leading-relaxed">
          Analyse your Strava segments. Replay your efforts. Compare your best rides.
        </p>

        {/* Connect button */}
        
          href="/api/auth/strava"
          className="inline-flex items-center gap-3 bg-strava hover:bg-strava-dark transition-colors px-6 py-3 rounded-xl text-white font-medium text-sm"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
            <path d="M13.5 3L9 14h3.5L8.5 21l9-11h-4.5z"/>
          </svg>
          Connect with Strava
        </a>

        {/* Note */}
        <p className="text-text-muted text-xs mt-6 leading-relaxed">
          We only read your data. Nothing is ever posted to your Strava profile.
        </p>

      </div>
    </main>
  )
}

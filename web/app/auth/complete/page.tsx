'use client'

import React, { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function AuthCompleteContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const token = searchParams.get('token')
    const name = searchParams.get('name') ?? ''

    if (!token) {
      router.push('/?error=auth_failed')
      return
    }

    localStorage.setItem('session', token)
    router.push(`/dashboard?name=${encodeURIComponent(name)}`)
  }, [])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-text-muted text-sm">Completing sign in...</div>
    </div>
  )
}

export default function AuthComplete() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-text-muted text-sm">Loading...</div>
      </div>
    }>
      <AuthCompleteContent />
    </Suspense>
  )
}

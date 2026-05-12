'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ActionRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/inventory-hub'); }, [router]);
  return null;
}

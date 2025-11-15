'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface NavLinkProps {
  to: string;
  children: React.ReactNode;
  className?: string;
}

export function NavLink({ to, children, className }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === to;

  return (
    <Link
      href={to}
      className={cn(
        'transition-colors hover:text-foreground/80',
        isActive ? 'text-foreground' : 'text-foreground/60',
        className
      )}
    >
      {children}
    </Link>
  );
}
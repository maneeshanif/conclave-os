import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'default' | 'outline' | 'ghost';
const variants: Record<Variant, string> = {
  default: 'bg-neutral-900 text-white hover:bg-neutral-800 disabled:bg-neutral-400',
  outline: 'border border-neutral-300 bg-white hover:bg-neutral-50 disabled:text-neutral-400',
  ghost: 'hover:bg-neutral-100',
};

export function Button({ variant = 'default', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn('inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed', variants[variant], className)}
      {...props}
    />
  );
}

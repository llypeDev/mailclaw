"use client";

import { Paper } from "@orangesys/ui";
import { useState } from "react";
import { useBranding } from "@/components/branding-provider";
import { LanguageSelector } from "@/components/language-selector";
import type { AuthShellProps } from "./types";

export function AuthShell({
  icon: Icon,
  title,
  description,
  children,
  footer,
  steps,
}: AuthShellProps) {
  const branding = useBranding();
  const [iconUrl, setIconUrl] = useState(branding.iconUrl);
  const [iconFailed, setIconFailed] = useState(false);
  const [brandingIconUrl, setBrandingIconUrl] = useState(branding.iconUrl);

  // Start over with the new icon whenever the branding icon changes.
  if (brandingIconUrl !== branding.iconUrl) {
    setBrandingIconUrl(branding.iconUrl);
    setIconUrl(branding.iconUrl);
    setIconFailed(false);
  }

  return (
    <div className="min-h-dvh bg-canvas text-fg sm:px-6 sm:py-6 lg:flex lg:items-center lg:px-10 lg:py-10">
      <Paper as="main" padding={0} className="mx-auto grid min-h-dvh w-full max-w-4xl grid-rows-[auto_1fr] overflow-hidden max-sm:border-0 sm:min-h-0 sm:grid-rows-none lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        {/* On wide screens the brand column sits on the canvas tone over Orange's 48px grid, split from the form by a 1px rule. */}
        <section className="flex flex-col p-7 sm:p-10 lg:border-e lg:border-line lg:bg-canvas-subtle lg:bg-[linear-gradient(var(--or-color-grid-line)_1px,transparent_1px),linear-gradient(90deg,var(--or-color-grid-line)_1px,transparent_1px)] lg:bg-[size:48px_48px] lg:bg-[position:-1px_-1px] lg:p-14">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center overflow-hidden">
              {iconFailed ? (
                <Icon className="h-8 w-8 text-accent" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- branding icon with an error fallback, at a fixed size
                <img
                  src={iconUrl}
                  onError={() => {
                    if (iconUrl !== "/icon-96.png") setIconUrl("/icon-96.png");
                    else setIconFailed(true);
                  }}
                  alt=""
                  className="h-8 w-8 object-contain"
                />
              )}
            </span>
            <span className="truncate font-display text-lg font-bold tracking-tight text-fg">
              {branding.appName}
            </span>
          </div>

          <div className="mt-10 sm:mt-6 lg:mt-8">
            <h1 className="max-w-md font-display text-3xl font-semibold leading-tight tracking-tight text-fg sm:text-4xl">
              {title}
            </h1>
            {description && (
              <p className="mt-5 max-w-md text-base leading-7 text-fg-muted">
                {description}
              </p>
            )}
          </div>

          <div className="mt-auto hidden pt-8 lg:block">
            <LanguageSelector variant="text" />
          </div>
        </section>

        <section className="flex min-w-0 flex-col justify-start px-7 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-0 sm:justify-center sm:p-10 lg:p-14">
          {steps && (
            <ol className="mb-7 flex flex-wrap gap-2 font-display text-xs font-medium uppercase tracking-[0.14em]">
              {steps.map((step, index) => (
                <li key={step.label} className="flex items-center gap-2" aria-current={step.active ? "step" : undefined}>
                  <span
                    className={
                      step.active ? "text-accent-text" : "text-fg-subtle"
                    }
                  >
                    <span className="font-mono tabular-nums">{index + 1}</span> {step.label}
                  </span>
                  {index < steps.length - 1 && (
                    <span aria-hidden="true" className="text-line-strong">/</span>
                  )}
                </li>
              ))}
            </ol>
          )}
          <div className="w-full">{children}</div>
          {footer && (
            <div className="mt-8 text-sm font-medium text-accent-text">
              {footer}
            </div>
          )}
          <div className="mt-auto pt-8 lg:hidden">
            <LanguageSelector variant="text" />
          </div>
        </section>
      </Paper>
    </div>
  );
}

"use client";

import { useLanguage } from "@/components/language-provider";
import { Skeleton } from "@/components/ui/skeleton";

export function BookingDetailSkeleton() {
	const { t } = useLanguage();
	return <div role="status" aria-label={t("public.loadingAvailability")} className="grid overflow-hidden border border-line bg-surface max-sm:border-x-0 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(240px,.95fr)_minmax(380px,1.65fr)_minmax(240px,.95fr)] lg:border-b-0">
		<span className="sr-only">{t("public.loadingAvailabilityEllipsis")}</span>
		<div className="space-y-6 border-b border-line p-7 sm:p-9 lg:border-b-0 lg:border-e">
			<Skeleton className="block h-6 w-2/3" />
			<Skeleton className="block h-4 w-full" />
			<Skeleton className="block h-4 w-4/5" />
			<Skeleton className="mt-10 block h-4 w-1/3" />
		</div>
		<div className="border-b border-line p-7 sm:p-9 lg:border-b-0 lg:border-e">
			<Skeleton className="block h-6 w-1/2" />
			<div className="mx-auto mt-10 grid max-w-[440px] grid-cols-7 gap-1">
				{Array.from({ length: 35 }, (_, index) => <Skeleton key={index} className="block aspect-square" />)}
			</div>
		</div>
		<div className="space-y-2 p-7 sm:p-9">
			<Skeleton className="mb-6 block h-6 w-3/4" />
			{[0, 1, 2, 3, 4].map((item) => <Skeleton key={item} className="block h-11" />)}
		</div>
	</div>;
}

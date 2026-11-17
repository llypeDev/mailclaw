"use client";

import { useLanguage } from "@/components/language-provider";
import { Skeleton } from "@/components/ui/skeleton";

export function BookingListSkeleton() {
	const { t } = useLanguage();
	return <div role="status" aria-label={t("booking.loading")} className="space-y-1">
		<span className="sr-only">{t("booking.loadingEllipsis")}</span>
		{[0, 1, 2].map((item) => <div key={item} className="border border-line bg-surface px-5 py-5">
			<Skeleton className="block h-5 w-1/2" />
			<Skeleton className="mt-4 block h-3 w-3/4" />
			<Skeleton className="mt-3 block h-3 w-2/5" />
		</div>)}
	</div>;
}

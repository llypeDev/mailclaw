"use client";

import { useLanguage } from "@/components/language-provider";
import { Skeleton } from "@/components/ui/skeleton";

export function BookingListSkeleton() {
	const { t } = useLanguage();
	return <div role="status" aria-label={t("public.loadingMeetings")} className="divide-y divide-line border border-line bg-surface">
		<span className="sr-only">{t("public.loadingMeetingsEllipsis")}</span>
		{[0, 1, 2].map((item) => <div key={item} className="p-5">
			<Skeleton className="block h-5 w-2/3" />
			<Skeleton className="mt-4 block h-3 w-5/6" />
			<Skeleton className="mt-3 block h-3 w-1/3" />
		</div>)}
	</div>;
}

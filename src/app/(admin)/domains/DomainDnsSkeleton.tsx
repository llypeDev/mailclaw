import { Skeleton } from "@/components/ui/skeleton";

export default function DomainDnsSkeleton() {
	return (
		<div className="space-y-3 border-t border-line pt-5">
			<Skeleton className="h-4 w-28" />
			<Skeleton className="h-3 w-96 max-w-full" />
			<div className="space-y-2">
				{Array.from({ length: 4 }, (_, index) => (
					<Skeleton key={index} className="h-16 w-full" />
				))}
			</div>
		</div>
	);
}

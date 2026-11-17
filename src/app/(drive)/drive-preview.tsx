"use client";

import { Download } from "@/components/icons";
import { buttonVariants } from "@/components/ui/button-utils";
import { useLanguage } from "@/components/language-provider";
import { canPreview } from "./drive-utils";

export function DrivePreviewBody({ src, downloadHref, contentType, name }: { src: string; downloadHref: string; contentType: string; name: string }) {
	const { t } = useLanguage();
	if (!canPreview(contentType)) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-4 text-sm text-fg-muted">
				<p>{t("drive.noPreview")}</p>
				<a href={downloadHref} className={`${buttonVariants({ variant: "outline" })} gap-2`}><Download size={16} />{t("drive.download")}</a>
			</div>
		);
	}
	// eslint-disable-next-line @next/next/no-img-element -- user file served by an authenticated API route, shown at its own size
	if (contentType.startsWith("image/")) return <img src={src} alt={name} className="mx-auto max-h-full max-w-full object-contain" />;
	if (contentType.startsWith("video/")) return <video src={src} controls className="mx-auto max-h-full max-w-full" />;
	if (contentType.startsWith("audio/")) return <div className="flex h-full items-center justify-center"><audio src={src} controls /></div>;
	return <iframe src={src} title={name} className="h-full w-full border border-line" style={{ background: "white", colorScheme: "light" }} />;
}

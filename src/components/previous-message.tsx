import { ChevronRight } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import type { PreviousMessageProps } from "./previous-message-types";

export function PreviousMessage({ message }: PreviousMessageProps) {
	const { t } = useLanguage();
	return (
		<details className="group mt-4 border-s-2 border-line ps-4">
			<summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-xs font-medium text-fg-subtle hover:text-fg">
				<ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none rtl:-scale-x-100 group-open:rotate-90 rtl:group-open:-rotate-90" />
				<span>
					{t(message.direction === "sent" ? "message.previous.sent" : "message.previous.received", { date: message.dateLine })}
				</span>
			</summary>
			<div className="pb-2 ps-5 text-fg-muted">
				{message.content && (
					<pre className="whitespace-pre-wrap text-sm font-sans">
						{message.content}
					</pre>
				)}
				{message.quotedContent.map((nestedMessage, index) => (
					<PreviousMessage
						key={`${nestedMessage.dateLine}-${nestedMessage.content.slice(0, 24)}-${index}`}
						message={nestedMessage}
					/>
				))}
			</div>
		</details>
	);
}

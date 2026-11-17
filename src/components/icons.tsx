import { forwardRef, type ComponentType, type ForwardRefExoticComponent, type ReactNode, type RefAttributes, type SVGProps } from "react";
import {
	Activity as IconoirActivity,
	AlignJustify as IconoirAlignJustify,
	AlignLeft as IconoirAlignLeft,
	Archive as IconoirArchive,
	ArrowDown as IconoirArrowDown,
	ArrowEmailForward as IconoirArrowEmailForward,
	ArrowLeft as IconoirArrowLeft,
	ArrowRight as IconoirArrowRight,
	ArrowSeparateVertical as IconoirArrowSeparateVertical,
	ArrowUp as IconoirArrowUp,
	AtSign as IconoirAtSign,
	Attachment as IconoirAttachment,
	Bell as IconoirBell,
	BellNotification as IconoirBellNotification,
	BellOff as IconoirBellOff,
	Bold as IconoirBold,
	Brain as IconoirBrain,
	Building as IconoirBuilding,
	Calendar as IconoirCalendar,
	CalendarPlus as IconoirCalendarPlus,
	Camera as IconoirCamera,
	Check as IconoirCheck,
	CheckCircle as IconoirCheckCircle,
	CheckSquare as IconoirCheckSquare,
	Clock as IconoirClock,
	Cloud as IconoirCloud,
	CloudUpload as IconoirCloudUpload,
	Code as IconoirCode,
	CodeBracketsSquare as IconoirCodeBracketsSquare,
	Collapse as IconoirCollapse,
	Copy as IconoirCopy,
	Database as IconoirDatabase,
	DatabaseBackup as IconoirDatabaseBackup,
	DotsGrid3x3 as IconoirDotsGrid3x3,
	Download as IconoirDownload,
	EditPencil as IconoirEditPencil,
	Edit as IconoirEdit,
	EmptyPage as IconoirEmptyPage,
	Erase as IconoirErase,
	Expand as IconoirExpand,
	Eye as IconoirEye,
	EyeClosed as IconoirEyeClosed,
	FileNotFound as IconoirFileNotFound,
	FilterList as IconoirFilterList,
	FloppyDisk as IconoirFloppyDisk,
	Folder as IconoirFolder,
	FolderPlus as IconoirFolderPlus,
	Globe as IconoirGlobe,
	Group as IconoirGroup,
	HardDrive as IconoirHardDrive,
	HelpCircle as IconoirHelpCircle,
	InfoCircle as IconoirInfoCircle,
	Italic as IconoirItalic,
	Key as IconoirKey,
	KeyCommand as IconoirKeyCommand,
	Link as IconoirLink,
	List as IconoirList,
	Lock as IconoirLock,
	LogIn as IconoirLogIn,
	LogOut as IconoirLogOut,
	LongArrowDownLeft as IconoirLongArrowDownLeft,
	LongArrowDownRight as IconoirLongArrowDownRight,
	Mail as IconoirMail,
	MailOpen as IconoirMailOpen,
	MapPin as IconoirMapPin,
	MediaImage as IconoirMediaImage,
	MediaImagePlus as IconoirMediaImagePlus,
	MediaVideo as IconoirMediaVideo,
	Medal as IconoirMedal,
	Minus as IconoirMinus,
	MoreHoriz as IconoirMoreHoriz,
	MoreVert as IconoirMoreVert,
	MusicDoubleNote as IconoirMusicDoubleNote,
	MusicNote as IconoirMusicNote,
	Notes as IconoirNotes,
	NumberedListLeft as IconoirNumberedListLeft,
	NavArrowDown as IconoirNavArrowDown,
	NavArrowLeft as IconoirNavArrowLeft,
	NavArrowRight as IconoirNavArrowRight,
	NavArrowUp as IconoirNavArrowUp,
	OpenNewWindow as IconoirOpenNewWindow,
	Package as IconoirPackage,
	Page as IconoirPage,
	Palette as IconoirPalette,
	PathArrow as IconoirPathArrow,
	Pause as IconoirPause,
	Play as IconoirPlay,
	Plus as IconoirPlus,
	Presentation as IconoirPresentation,
	Prohibition as IconoirProhibition,
	Quote as IconoirQuote,
	Refresh as IconoirRefresh,
	RefreshDouble as IconoirRefreshDouble,
	Repeat as IconoirRepeat,
	Reply as IconoirReply,
	Search as IconoirSearch,
	Send as IconoirSend,
	SendMail as IconoirSendMail,
	Server as IconoirServer,
	ServerConnection as IconoirServerConnection,
	Settings as IconoirSettings,
	ShareAndroid as IconoirShareAndroid,
	Shield as IconoirShield,
	ShieldAlert as IconoirShieldAlert,
	ShieldCheck as IconoirShieldCheck,
	ShieldXmark as IconoirShieldXmark,
	SmartphoneDevice as IconoirSmartphoneDevice,
	Sparks as IconoirSparks,
	Square as IconoirSquare,
	Star as IconoirStar,
	Strikethrough as IconoirStrikethrough,
	Table as IconoirTable,
	TaskList as IconoirTaskList,
	Text as IconoirText,
	Trash as IconoirTrash,
	Underline as IconoirUnderline,
	Undo as IconoirUndo,
	Upload as IconoirUpload,
	User as IconoirUser,
	UserPlus as IconoirUserPlus,
	VideoCamera as IconoirVideoCamera,
	ViewColumns2 as IconoirViewColumns2,
	WarningCircle as IconoirWarningCircle,
	WarningTriangle as IconoirWarningTriangle,
	Wrench as IconoirWrench,
	Xmark as IconoirXmark,
	XmarkCircle as IconoirXmarkCircle,
} from "iconoir-react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
	size?: string | number;
	strokeWidth?: number;
	absoluteStrokeWidth?: boolean;
};

export type LucideIcon = ComponentType<IconProps>;
export type IconNode = LucideIcon;

type SvgIcon = ForwardRefExoticComponent<Omit<SVGProps<SVGSVGElement>, "ref"> & RefAttributes<SVGSVGElement>>;

/** Iconoir's own weight on its 24px grid; it matches Orange's 1px borders better than the old set's 2. */
const DEFAULT_STROKE_WIDTH = 1.5;

/**
 * Icons that point "back", "forward", "previous" or "next" and therefore mirror
 * when the document is right-to-left (Arabic, Urdu, Persian set dir="rtl" on <html>):
 * ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Reply, ReplyAll, Forward.
 * A chevron that the caller rotates (a disclosure toggle, e.g. `rotate-90` when open)
 * is left alone, because mirroring before the rotation would turn "down" into "up".
 */
const RTL_MIRROR_CLASS = "rtl:-scale-x-100";
const ROTATED_CLASS = /(?:^|[\s:])-?rotate-/;

function withRtlMirror(className: string | undefined): string {
	if (!className) return RTL_MIRROR_CLASS;
	return ROTATED_CLASS.test(className) ? className : `${className} ${RTL_MIRROR_CLASS}`;
}

export const HamburgerMenuIcon = forwardRef<SVGSVGElement, IconProps>(
	({ size = 24, strokeWidth: _strokeWidth, absoluteStrokeWidth: _abs, ...props }, ref) => (
		<svg
			ref={ref}
			width={size}
			height={size}
			viewBox="0 0 12 12"
			fill="currentColor"
			aria-hidden="true"
			{...props}
		>
			<rect height="1" width="11" x="0.5" y="2.5" />
			<rect height="1" width="11" x="0.5" y="5.5" />
			<rect height="1" width="11" x="0.5" y="8.5" />
		</svg>
	),
);
HamburgerMenuIcon.displayName = "HamburgerMenuIcon";

function createIcon(Icon: SvgIcon, displayName: string, options: { mirrorInRtl?: boolean } = {}): LucideIcon {
	const Wrapped = forwardRef<SVGSVGElement, IconProps>(
		({ size = 24, strokeWidth = DEFAULT_STROKE_WIDTH, absoluteStrokeWidth = false, color = "currentColor", className, ...props }, ref) => (
			<Icon
				ref={ref}
				width={size}
				height={size}
				color={color}
				strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
				className={options.mirrorInRtl ? withRtlMirror(className) : className}
				{...props}
			/>
		),
	);
	Wrapped.displayName = displayName;
	return Wrapped;
}

/** Iconoir has no glyph for these; they are drawn on the same 24px grid with Iconoir's conventions. */
function composeIcon(displayName: string, paths: ReactNode): SvgIcon {
	const Icon = forwardRef<SVGSVGElement, Omit<SVGProps<SVGSVGElement>, "ref">>((props, ref) => (
		<svg
			ref={ref}
			width="1.5em"
			height="1.5em"
			strokeWidth={1.5}
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			color="currentColor"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			{...props}
		>
			{paths}
		</svg>
	));
	Icon.displayName = displayName;
	return Icon;
}

const CIRCLE = "M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z";

const ComposedArchiveRestore = composeIcon("ArchiveRestore",
	<>
		<path d="M2.6 12H21.4C21.7314 12 22 12.2686 22 12.6V21.4C22 21.7314 21.7314 22 21.4 22H2.6C2.26863 22 2 21.7314 2 21.4V12.6C2 12.2686 2.26863 12 2.6 12Z" />
		<path d="M9 17H15" />
		<path d="M12 9V2M12 2L8.5 5.5M12 2L15.5 5.5" />
	</>,
);
const ComposedCalendarClock = composeIcon("CalendarClock",
	<>
		<path d="M21 10V6C21 4.89543 20.1046 4 19 4H5C3.89543 4 3 4.89543 3 6V19C3 20.1046 3.89543 21 5 21H10.5" />
		<path d="M3 10H21M8 2V6M16 2V6" />
		<path d="M17.5 22C19.9853 22 22 19.9853 22 17.5C22 15.0147 19.9853 13 17.5 13C15.0147 13 13 15.0147 13 17.5C13 19.9853 15.0147 22 17.5 22Z" />
		<path d="M17.5 15.5V17.5L18.5 18.5" />
	</>,
);
const ComposedFolderInput = composeIcon("FolderInput",
	<>
		<path d="M2 9V4.6C2 4.26863 2.26863 4 2.6 4H8.77805C8.92127 4 9.05977 4.05124 9.16852 4.14445L12.3315 6.85555C12.4402 6.94876 12.5787 7 12.722 7H21.4C21.7314 7 22 7.26863 22 7.6V19.4C22 19.7314 21.7314 20 21.4 20H2.6C2.26863 20 2 19.7314 2 19.4V18" />
		<path d="M2 13.5H12M12 13.5L9 10.5M12 13.5L9 16.5" />
	</>,
);
const ComposedInbox = composeIcon("Inbox",
	<>
		<path d="M2 13V19.4C2 19.7314 2.26863 20 2.6 20H21.4C21.7314 20 22 19.7314 22 19.4V13" />
		<path d="M2 13L5.35 4.39C5.44 4.16 5.66 4 5.91 4H18.09C18.34 4 18.56 4.16 18.65 4.39L22 13" />
		<path d="M2 13H8L9 16H15L16 13H22" />
	</>,
);
const ComposedLoader = composeIcon("Loader", <path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2" />);
const ComposedMailCheck = composeIcon("MailCheck",
	<>
		<path d="M5 9L9.5 12L14 9" />
		<path d="M13 19H3C1.89543 19 1 18.1046 1 17V7C1 5.89543 1.89543 5 3 5H16C17.1046 5 18 5.89543 18 7V12" />
		<path d="M16 17L18 19L22 15" />
	</>,
);
const ComposedMailPlus = composeIcon("MailPlus",
	<>
		<path d="M5 9L9.5 12L14 9" />
		<path d="M14 19H3C1.89543 19 1 18.1046 1 17V7C1 5.89543 1.89543 5 3 5H16C17.1046 5 18 5.89543 18 7V10" />
		<path d="M17 16H23M20 13V19" />
	</>,
);
const ComposedPauseCircle = composeIcon("PauseCircle",
	<>
		<path d={CIRCLE} />
		<path d="M9.5 15V9M14.5 15V9" />
	</>,
);
const ComposedReplyAll = composeIcon("ReplyAll",
	<>
		<path d="M7 10H16C24 10 24 21 16 21M7 10L13 4M7 10L13 16" />
		<path d="M8 4L2 10L8 16" />
	</>,
);
/** Iconoir's Refresh, mirrored: the arrow turns counter-clockwise. */
const ComposedRotateCcw = composeIcon("RotateCcw",
	<>
		<path d="M2.1117 13.5C2.8355 18.3113 6.987 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C7.8994 2 4.3752 4.46819 2.8321 8" />
		<path d="M7 8H2.6C2.26863 8 2 7.73137 2 7.4V3" />
	</>,
);

export const Activity = createIcon(IconoirActivity, "Activity");
export const AlertCircle = createIcon(IconoirWarningCircle, "AlertCircle");
export const AlertTriangle = createIcon(IconoirWarningTriangle, "AlertTriangle");
export const AlignLeft = createIcon(IconoirAlignLeft, "AlignLeft");
export const Archive = createIcon(IconoirArchive, "Archive");
export const ArchiveRestore = createIcon(ComposedArchiveRestore, "ArchiveRestore");
export const ArrowDown = createIcon(IconoirArrowDown, "ArrowDown");
export const ArrowDownToLine = createIcon(IconoirDownload, "ArrowDownToLine");
export const ArrowLeft = createIcon(IconoirArrowLeft, "ArrowLeft", { mirrorInRtl: true });
export const ArrowRight = createIcon(IconoirArrowRight, "ArrowRight", { mirrorInRtl: true });
export const ArrowUp = createIcon(IconoirArrowUp, "ArrowUp");
export const AtSign = createIcon(IconoirAtSign, "AtSign");
export const BadgeDollarSign = createIcon(IconoirMedal, "BadgeDollarSign");
export const Ban = createIcon(IconoirProhibition, "Ban");
export const Bell = createIcon(IconoirBell, "Bell");
export const BellOff = createIcon(IconoirBellOff, "BellOff");
export const BellRing = createIcon(IconoirBellNotification, "BellRing");
export const Bold = createIcon(IconoirBold, "Bold");
export const Bot = createIcon(IconoirBrain, "Bot");
export const Building2 = createIcon(IconoirBuilding, "Building2");
export const CalendarClock = createIcon(ComposedCalendarClock, "CalendarClock");
export const CalendarDays = createIcon(IconoirCalendar, "CalendarDays");
export const CalendarPlus2 = createIcon(IconoirCalendarPlus, "CalendarPlus2");
export const Camera = createIcon(IconoirCamera, "Camera");
export const Check = createIcon(IconoirCheck, "Check");
export const CheckCircle2 = createIcon(IconoirCheckCircle, "CheckCircle2");
export const CheckSquare2 = createIcon(IconoirCheckSquare, "CheckSquare2");
export const ChevronDown = createIcon(IconoirNavArrowDown, "ChevronDown");
export const ChevronLeft = createIcon(IconoirNavArrowLeft, "ChevronLeft", { mirrorInRtl: true });
export const ChevronRight = createIcon(IconoirNavArrowRight, "ChevronRight", { mirrorInRtl: true });
export const ChevronUp = createIcon(IconoirNavArrowUp, "ChevronUp");
export const ChevronsUpDown = createIcon(IconoirArrowSeparateVertical, "ChevronsUpDown");
export const CircleX = createIcon(IconoirXmarkCircle, "CircleX");
export const Clock = createIcon(IconoirClock, "Clock");
export const Clock3 = createIcon(IconoirClock, "Clock3");
export const Cloud = createIcon(IconoirCloud, "Cloud");
export const Columns2 = createIcon(IconoirViewColumns2, "Columns2");
export const Copy = createIcon(IconoirCopy, "Copy");
export const CornerDownLeft = createIcon(IconoirLongArrowDownLeft, "CornerDownLeft");
export const CornerDownRight = createIcon(IconoirLongArrowDownRight, "CornerDownRight");
export const Database = createIcon(IconoirDatabase, "Database");
export const DatabaseBackup = createIcon(IconoirDatabaseBackup, "DatabaseBackup");
export const Download = createIcon(IconoirDownload, "Download");
export const ExternalLink = createIcon(IconoirOpenNewWindow, "ExternalLink");
export const Eye = createIcon(IconoirEye, "Eye");
export const EyeOff = createIcon(IconoirEyeClosed, "EyeOff");
export const File = createIcon(IconoirEmptyPage, "File");
export const FileArchive = createIcon(IconoirPackage, "FileArchive");
export const FileAudio = createIcon(IconoirMusicDoubleNote, "FileAudio");
export const FileCode = createIcon(IconoirCodeBracketsSquare, "FileCode");
export const FileCode2 = createIcon(IconoirCode, "FileCode2");
export const FileImage = createIcon(IconoirMediaImage, "FileImage");
export const FileSpreadsheet = createIcon(IconoirTable, "FileSpreadsheet");
export const FileText = createIcon(IconoirPage, "FileText");
export const FileType = createIcon(IconoirText, "FileType");
export const FileVideo = createIcon(IconoirMediaVideo, "FileVideo");
export const FileVideoCamera = createIcon(IconoirVideoCamera, "FileVideoCamera");
export const FileWarning = createIcon(IconoirFileNotFound, "FileWarning");
export const Folder = createIcon(IconoirFolder, "Folder");
export const FolderInput = createIcon(ComposedFolderInput, "FolderInput");
export const FolderPlus = createIcon(IconoirFolderPlus, "FolderPlus");
export const Forward = createIcon(IconoirArrowEmailForward, "Forward", { mirrorInRtl: true });
export const Globe2 = createIcon(IconoirGlobe, "Globe2");
export const HardDrive = createIcon(IconoirHardDrive, "HardDrive");
export const HelpCircle = createIcon(IconoirHelpCircle, "HelpCircle");
export const Image = createIcon(IconoirMediaImage, "Image");
export const ImagePlus = createIcon(IconoirMediaImagePlus, "ImagePlus");
export const Inbox = createIcon(ComposedInbox, "Inbox");
export const Info = createIcon(IconoirInfoCircle, "Info");
export const Italic = createIcon(IconoirItalic, "Italic");
export const KeyRound = createIcon(IconoirKey, "KeyRound");
export const Keyboard = createIcon(IconoirKeyCommand, "Keyboard");
export const Link2 = createIcon(IconoirLink, "Link2");
export const List = createIcon(IconoirList, "List");
export const ListChecks = createIcon(IconoirTaskList, "ListChecks");
export const ListFilter = createIcon(IconoirFilterList, "ListFilter");
export const ListOrdered = createIcon(IconoirNumberedListLeft, "ListOrdered");
export const Loader2 = createIcon(ComposedLoader, "Loader2");
export const LockKeyhole = createIcon(IconoirLock, "LockKeyhole");
export const LogIn = createIcon(IconoirLogIn, "LogIn");
export const LogOut = createIcon(IconoirLogOut, "LogOut");
export const Mail = createIcon(IconoirMail, "Mail");
export const MailCheck = createIcon(ComposedMailCheck, "MailCheck");
export const MailOpen = createIcon(IconoirMailOpen, "MailOpen");
export const MailSend01 = createIcon(IconoirSendMail, "MailSend01");
export const MailPlus = createIcon(ComposedMailPlus, "MailPlus");
export const MapPin = createIcon(IconoirMapPin, "MapPin");
export const Maximize2 = createIcon(IconoirExpand, "Maximize2");
export const Menu: LucideIcon = HamburgerMenuIcon;
export const Minimize2 = createIcon(IconoirCollapse, "Minimize2");
export const Minus = createIcon(IconoirMinus, "Minus");
export const More01 = createIcon(IconoirDotsGrid3x3, "More01");
export const MoreHorizontal = createIcon(IconoirMoreHoriz, "MoreHorizontal");
export const MoreVertical = createIcon(IconoirMoreVert, "MoreVertical");
export const Music = createIcon(IconoirMusicNote, "Music");
export const Palette = createIcon(IconoirPalette, "Palette");
export const Paperclip = createIcon(IconoirAttachment, "Paperclip");
export const Pause = createIcon(IconoirPause, "Pause");
export const PauseCircle = createIcon(ComposedPauseCircle, "PauseCircle");
export const Note = createIcon(IconoirNotes, "Note");
export const PenLine = createIcon(IconoirEdit, "PenLine");
export const Edit04 = createIcon(IconoirEditPencil, "Edit04");
export const Pencil = createIcon(IconoirEditPencil, "Pencil");
export const Play = createIcon(IconoirPlay, "Play");
export const Plus = createIcon(IconoirPlus, "Plus");
export const Presentation = createIcon(IconoirPresentation, "Presentation");
export const Quote = createIcon(IconoirQuote, "Quote");
export const RefreshCw = createIcon(IconoirRefreshDouble, "RefreshCw");
export const RemoveFormatting = createIcon(IconoirErase, "RemoveFormatting");
export const Repeat2 = createIcon(IconoirRepeat, "Repeat2");
export const Reply = createIcon(IconoirReply, "Reply", { mirrorInRtl: true });
export const ReplyAll = createIcon(ComposedReplyAll, "ReplyAll", { mirrorInRtl: true });
export const RotateCcw = createIcon(ComposedRotateCcw, "RotateCcw");
export const RotateCw = createIcon(IconoirRefresh, "RotateCw");
export const Route = createIcon(IconoirPathArrow, "Route");
export const Save = createIcon(IconoirFloppyDisk, "Save");
export const Search = createIcon(IconoirSearch, "Search");
export const Send = createIcon(IconoirSend, "Send");
export const Server = createIcon(IconoirServer, "Server");
export const Settings = createIcon(IconoirSettings, "Settings");
export const Settings2 = createIcon(IconoirSettings, "Settings2");
export const Share2 = createIcon(IconoirShareAndroid, "Share2");
export const Shield = createIcon(IconoirShield, "Shield");
export const ShieldAlert = createIcon(IconoirShieldAlert, "ShieldAlert");
export const ShieldCheck = createIcon(IconoirShieldCheck, "ShieldCheck");
export const ShieldOff = createIcon(IconoirShieldXmark, "ShieldOff");
export const Smartphone = createIcon(IconoirSmartphoneDevice, "Smartphone");
export const Sparkles = createIcon(IconoirSparks, "Sparkles");
export const Square = createIcon(IconoirSquare, "Square");
export const Star = createIcon(IconoirStar, "Star");
export const Strikethrough = createIcon(IconoirStrikethrough, "Strikethrough");
export const TextAlignJustify = createIcon(IconoirAlignJustify, "TextAlignJustify");
export const Trash2 = createIcon(IconoirTrash, "Trash2");
export const Underline = createIcon(IconoirUnderline, "Underline");
export const Undo2 = createIcon(IconoirUndo, "Undo2");
export const Upload = createIcon(IconoirUpload, "Upload");
export const UploadCloud = createIcon(IconoirCloudUpload, "UploadCloud");
export const User = createIcon(IconoirUser, "User");
export const UserPlus = createIcon(IconoirUserPlus, "UserPlus");
export const UserRound = createIcon(IconoirUser, "UserRound");
export const Users = createIcon(IconoirGroup, "Users");
export const UsersRound = createIcon(IconoirGroup, "UsersRound");
export const Webhook = createIcon(IconoirServerConnection, "Webhook");
export const Wrench = createIcon(IconoirWrench, "Wrench");
export const X = createIcon(IconoirXmark, "X");
export const XCircle = createIcon(IconoirXmarkCircle, "XCircle");
export const LoaderCircle = Loader2;
export const ArchiveIcon = Archive;
export const InboxIcon = Inbox;
export const ShieldIcon = Shield;
export const ShieldAlertIcon = ShieldAlert;
export const Trash2Icon = Trash2;
export const TrashIcon = Trash2;

import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useWorkConfig } from "@/context/WorkConfigContext";
import { useAuth } from "@/context/AuthContext";
import {
  DEFAULT_OVERTIME_MULTIPLIER,
  MAX_OVERTIME_MULTIPLIER,
  MIN_OVERTIME_MULTIPLIER,
} from "@/lib/activityTypes";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  X,
  Loader2,
  Clock,
  CalendarOff,
  BellRing,
  CalendarCheck,
  FileSpreadsheet,
  Briefcase,
  CalendarDays,
  History,
  type LucideIcon,
} from "lucide-react";
import { DEFAULT_SUPERVISOR_BACKFILL_WINDOW_DAYS, MAX_SUPERVISOR_BACKFILL_WINDOW_DAYS } from "@/lib/backfillWindow";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type WorkSchedule = {
  fullDayHours: number;
  halfDayHours: number;
  overtimeThreshold: number;
  weeklyHolidays: string[];
  breakDurationMinutes: number;
  // Raw hours before the single daily break is deducted. The server stores null for
  // "use fullDayHours"; normalizeSchedule fills that in so the form shows the value in
  // effect. Cleared in the form → null → back to the fallback.
  breakMinHours: number | null;
  checkoutReminderTime: string;
  checkoutRemarkGraceMinutes: number;
  lopDeductionAmount: number;
  erpCompanyName: string;
  erpDefaultActivityType: string;
  erpOvertimeActivityType: string;
  erpOvertimeType: string;
  erpPaidLeaveType: string;
  // Rate multiplier of every activity type's automatic overtime twin (Activity Types page).
  // Superadmin-only: the server 403s anyone else, so admins never send it.
  overtimeActivityMultiplier: number;
  // Mirrors ERPNext "Consider Unmarked Attendance As": true = Absent (deducted from
  // Payment Days in the report + timesheet), false = Present (paid).
  countUnmarkedAsAbsent: boolean;
  // Past days a supervisor may backfill (1–10; the 10 is hard-coded).
  supervisorBackfillWindowDays: number;
};

type Holiday = {
  _id: string;
  date: string;
  reason: string;
};

// Each settings section saves on its own: PATCH /api/config/update only touches the fields
// it is sent, so a section posts just its own fields and never overwrites the others.
type SectionId = "hours" | "weekly" | "checkout" | "leave" | "backfill" | "erp";

type SettingsSection = {
  id: SectionId;
  title: string;
  description: string;
  icon: LucideIcon;
  fields: (keyof WorkSchedule)[];
};

const SECTIONS: Record<SectionId, SettingsSection> = {
  hours: {
    id: "hours",
    title: "Working Hours & Breaks",
    description: "Configure attendance thresholds, overtime and break deductions.",
    icon: Clock,
    fields: ["fullDayHours", "halfDayHours", "overtimeThreshold", "breakDurationMinutes", "breakMinHours"],
  },
  weekly: {
    id: "weekly",
    title: "Weekly Off Days",
    description: "Select recurring weekly off days.",
    icon: CalendarOff,
    fields: ["weeklyHolidays"],
  },
  checkout: {
    id: "checkout",
    title: "Check-out Rules",
    description: "Reminders for forgotten check-outs, and when a late check-out needs a remark.",
    icon: BellRing,
    fields: ["checkoutReminderTime", "checkoutRemarkGraceMinutes"],
  },
  leave: {
    id: "leave",
    title: "Loss of Pay",
    description: "The Loss of Pay remark. Annual leave is allocated on the Leave page.",
    icon: CalendarCheck,
    fields: ["lopDeductionAmount"],
  },
  backfill: {
    id: "backfill",
    title: "Supervisor Backfill",
    description: "How many past days supervisors can backfill and send for approval.",
    icon: History,
    fields: ["supervisorBackfillWindowDays"],
  },
  erp: {
    id: "erp",
    title: "ERPNext Export",
    description: "Labels for the ERPNext import files, and how days with no record count toward Payment Days.",
    icon: FileSpreadsheet,
    fields: [
      "erpCompanyName",
      "erpDefaultActivityType",
      "erpOvertimeActivityType",
      "erpOvertimeType",
      "erpPaidLeaveType",
      "overtimeActivityMultiplier",
      "countUnmarkedAsAbsent",
    ],
  },
};

const SCHEDULE_FIELDS = Object.values(SECTIONS).flatMap((s) => s.fields);

// Missing and empty compare equal (older config docs may lack the newer fields); weekly
// holidays compare as a set so re-ticking a day in another order isn't a change.
const sameValue = (a: unknown, b: unknown) => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && [...a].sort().join() === [...b].sort().join();
  }
  return (a ?? "") === (b ?? "");
};

// The break threshold is stored as null until set ("use full-day hours"); show the value in
// effect instead, so the field is never blank and the dirty check compares like with like.
const normalizeSchedule = (data: WorkSchedule): WorkSchedule => ({
  ...data,
  breakMinHours: data.breakMinHours ?? data.fullDayHours,
  overtimeActivityMultiplier: data.overtimeActivityMultiplier ?? DEFAULT_OVERTIME_MULTIPLIER,
  // Config docs that predate the field are ON (the server reads it the same way).
  countUnmarkedAsAbsent: data.countUnmarkedAsAbsent !== false,
  supervisorBackfillWindowDays: data.supervisorBackfillWindowDays ?? DEFAULT_SUPERVISOR_BACKFILL_WINDOW_DAYS,
});

const pickFields = (src: WorkSchedule, fields: (keyof WorkSchedule)[]) =>
  Object.fromEntries(fields.map((f) => [f, src[f]])) as Partial<WorkSchedule>;

const days = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const months = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

const getCurrentMonthYear = () => {
  const now = new Date();
  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------- LAYOUT PIECES ----------------
const ITEM_CLASS = "overflow-hidden rounded-xl border bg-card shadow-sm last:border-b";
const TRIGGER_CLASS = "min-w-0 rounded-none px-4 py-3.5 hover:bg-muted/40 focus-visible:ring-inset sm:px-5";
const CONTENT_CLASS = "border-t px-4 pt-5 pb-5 sm:px-5";

function SectionHeader({
  icon: Icon,
  title,
  summary,
  dirty,
}: {
  icon: LucideIcon;
  title: string;
  summary: string;
  dirty?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold">{title}</span>
          {dirty && (
            <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400">
              Unsaved changes
            </Badge>
          )}
        </div>
        <p className="truncate text-xs font-normal text-muted-foreground">
          {summary}
        </p>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function Configure() {
  const { refreshConfig } = useWorkConfig();
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  // The fields a section posts: the activity-type multiplier is superadmin-only (the server
  // refuses it from anyone else), so an admin's ERPNext save leaves it out.
  const postedFields = (section: SettingsSection) =>
    isSuperadmin ? section.fields : section.fields.filter((f) => f !== "overtimeActivityMultiplier");

  // `schedule` is the editable draft; `saved` is the last copy the server confirmed.
  const [schedule, setSchedule] = useState<WorkSchedule>({
    fullDayHours: 8,
    halfDayHours: 4,
    overtimeThreshold: 8,
    weeklyHolidays: [],
    breakDurationMinutes: 60,
    breakMinHours: 8,
    checkoutReminderTime: "20:00",
    checkoutRemarkGraceMinutes: 15,
    lopDeductionAmount: 3.5,
    erpCompanyName: "New Gulf Desert Projects LLC",
    erpDefaultActivityType: "Construction",
    erpOvertimeActivityType: "",
    erpOvertimeType: "",
    erpPaidLeaveType: "Annual Leave",
    overtimeActivityMultiplier: DEFAULT_OVERTIME_MULTIPLIER,
    countUnmarkedAsAbsent: true,
    supervisorBackfillWindowDays: DEFAULT_SUPERVISOR_BACKFILL_WINDOW_DAYS,
  });
  const [saved, setSaved] = useState<WorkSchedule | null>(null);
  const [scheduleLoadFailed, setScheduleLoadFailed] = useState(false);

  const [holidayForm, setHolidayForm] = useState({
    date: "",
    reason: "",
  });

  type CollarType = "skilled" | "staff"

  type jobTitle = {
    _id: string,
    title: string,
    collarType?: CollarType
  }

  const [jobTitles, setJobtitles] = useState<jobTitle[]>([])
  const [newTitleCollar, setNewTitleCollar] = useState<CollarType>("skilled")
  const [updatingCollarId, setUpdatingCollarId] = useState<string | null>(null)

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [filter, setFilter] = useState(getCurrentMonthYear());

  // Loader states
  const [savingSection, setSavingSection] = useState<SectionId | null>(null);
  const [addingJobTitle, setAddingJobTitle] = useState(false);
  const [deletingJobTitle, setDeletingJobTitle] = useState<string | null>(null);
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [deletingHoliday, setDeletingHoliday] = useState<string | null>(null);
  const [holidayToDelete, setHolidayToDelete] = useState<Holiday | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const fetchJobTitles = async () => {
    try{
      const res = await api.get('/api/employees/jobTitles')

      setJobtitles(res.data)
    }catch(error){
      console.log(error)
    }
  }

  // ---------------- FETCH ----------------
  const fetchSchedule = async () => {
    try {
      setScheduleLoadFailed(false);
      const res = await api.get("/api/config");
      const loaded = normalizeSchedule(res.data.data);
      setSchedule(loaded);
      setSaved(loaded);
    } catch {
      setScheduleLoadFailed(true);
      toast.error("Failed to load work schedule");
    }
  };

  const fetchHolidays = async (month = filter.month, year = filter.year) => {
    try {
      const res = await api.get(
        `/api/config/custom-holidays?month=${month}&year=${year}`
      );

      setHolidays(res.data.data);
    } catch {
      toast.error("Failed to load holidays");
    }
  };

  // ---------------- UPDATE ----------------
  const setField = <K extends keyof WorkSchedule>(key: K, value: WorkSchedule[K]) =>
    setSchedule((prev) => ({ ...prev, [key]: value }));

  const isDirty = (section: SettingsSection) =>
    !!saved && section.fields.some((f) => !sameValue(schedule[f], saved[f]));

  const saveSection = async (section: SettingsSection) => {
    try {
      setSavingSection(section.id);
      const res = await api.patch(
        "/api/config/update",
        pickFields(schedule, postedFields(section))
      );

      const raw = res.data?.data as WorkSchedule | undefined;
      const next = raw ? normalizeSchedule(raw) : undefined;
      if (next) {
        // Take the server's copy for this section and for any field left untouched; keep
        // unsaved edits in the OTHER sections.
        setSchedule((prev) => {
          const merged: Record<string, unknown> = { ...prev };
          for (const f of SCHEDULE_FIELDS) {
            if (section.fields.includes(f) || sameValue(prev[f], saved?.[f])) {
              merged[f] = next[f];
            }
          }
          return merged as WorkSchedule;
        });
        setSaved(next);
      }
      await refreshConfig();

      toast.success(`${section.title} saved`);
    } catch (err: any) {
      // Keep the draft so the value the server refused can be corrected in place.
      const body = err?.response?.data;
      toast.error(body?.message || `Failed to save ${section.title}`, {
        duration: 8000,
      });
    } finally {
      setSavingSection(null);
    }
  };

  const discardSection = (section: SettingsSection) => {
    if (!saved) return;
    setSchedule((prev) => ({ ...prev, ...pickFields(saved, section.fields) }));
  };

  const addHoliday = async () => {
    try {
      setAddingHoliday(true);
      await api.post("/api/config/custom-holidays", holidayForm);

      setHolidayForm({ date: "", reason: "" });
      fetchHolidays();

      toast.success("Holiday added successfully");
    } catch (err) {
      toast.error("Failed to add holiday");
    } finally {
      setAddingHoliday(false);
    }
  };

  const deleteHoliday = async (id: string) => {
    try {
      setDeletingHoliday(id);
      await api.delete(`/api/config/custom-holidays/${id}`);
      fetchHolidays();
      toast.success("Holiday deleted successfully");
      setIsDeleteConfirmOpen(false);
      setHolidayToDelete(null);
    } catch (err) {
      toast.error("Failed to delete holiday");
    } finally {
      setDeletingHoliday(null);
    }
  };

  const formatJobTitle = (title: string) => {
    return title
      .trim()
      .split(" ")
      .filter(Boolean)
      .map((word) => {
        if (word.length <= 2) {
          return word.toUpperCase();
        }

        return (
          word.charAt(0).toUpperCase() +
          word.slice(1).toLowerCase()
        );
      })
      .join(" ");
  };

  const [jobTitleInput, setJobTitleInput] = useState("");

  const addJobTitle = async () => {
    try {
      const formattedTitle = formatJobTitle(jobTitleInput);

      if (!formattedTitle) {
        return toast.error("Enter a job title");
      }

      setAddingJobTitle(true);
      await api.post("/api/employees/jobTitles", {
        title: formattedTitle,
        collarType: newTitleCollar,
      });

      toast.success("Job title added");

      setJobTitleInput("");
      setNewTitleCollar("skilled");

      fetchJobTitles();
    } catch (error: unknown) {
      console.log(error);
      const message =
        error &&
        typeof error === "object" &&
        "response" in error &&
        error.response &&
        typeof error.response === "object" &&
        "data" in error.response &&
        error.response.data &&
        typeof error.response.data === "object" &&
        "message" in error.response.data &&
        typeof error.response.data.message === "string"
          ? error.response.data.message
          : "Failed to add job title";
      toast.error(message);
    } finally {
      setAddingJobTitle(false);
    }
  };

  const deleteJobTitle = async (id: string) => {
    try {
      setDeletingJobTitle(id);
      await api.delete(`/api/employees/jobTitles/${id}`);

      toast.success("Job title deleted");

      fetchJobTitles();
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
        "Failed to delete job title"
      );
    } finally {
      setDeletingJobTitle(null);
    }
  };

  // Reclassify a title as Skilled Labour / Staff. The backend re-syncs the
  // collarType on every employee holding this title.
  const updateTitleCollar = async (id: string, collarType: CollarType) => {
    try {
      setUpdatingCollarId(id);
      await api.patch(`/api/employees/jobTitles/${id}`, { collarType });
      toast.success("Category updated");
      fetchJobTitles();
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message || "Failed to update category"
      );
    } finally {
      setUpdatingCollarId(null);
    }
  };

  useEffect(() => {
    fetchSchedule();
    fetchHolidays();
    fetchJobTitles();
  }, []);

  useEffect(() => {
    fetchHolidays(filter.month, filter.year);
  }, [filter]);

  const filteredJobTitles = jobTitles.filter((job) =>
    job.title
      .toLowerCase()
      .includes(jobTitleInput.toLowerCase())
  );

  // ---------------- SUMMARIES (collapsed headers show what's in effect) ----------------
  const summaries: Record<SectionId, string> = saved
    ? {
        hours: `Full day ${saved.fullDayHours}h · Half day ${saved.halfDayHours}h · OT after ${saved.overtimeThreshold}h · Break ${saved.breakDurationMinutes} min after ${saved.breakMinHours ?? saved.fullDayHours}h`,
        weekly:
          days
            .filter((d) => saved.weeklyHolidays?.includes(d))
            .map(capitalize)
            .join(", ") || "No weekly off days",
        checkout: `Reminder ${saved.checkoutReminderTime || "off"} · Remark after ${saved.checkoutRemarkGraceMinutes ?? 15} min over default`,
        leave: `LOP deduct ${saved.lopDeductionAmount ?? 3.5} OMR`,
        backfill: `Past ${saved.supervisorBackfillWindowDays} day${saved.supervisorBackfillWindowDays === 1 ? "" : "s"}`,
        erp: `${saved.erpCompanyName || "Company name not set"} · Unmarked days = ${saved.countUnmarkedAsAbsent === false ? "Present" : "Absent"}`,
      }
    : {
        hours: "Loading…",
        weekly: "Loading…",
        checkout: "Loading…",
        leave: "Loading…",
        backfill: "Loading…",
        erp: "Loading…",
      };

  const staffTitleCount = jobTitles.filter((j) => j.collarType === "staff").length;
  const jobTitlesSummary = `${jobTitles.length} ${jobTitles.length === 1 ? "title" : "titles"} · ${jobTitles.length - staffTitleCount} skilled · ${staffTitleCount} staff`;

  const filterMonthLabel =
    months.find((m) => m.value === filter.month)?.label ?? "";
  const holidaysSummary = `${holidays.length} in ${filterMonthLabel} ${filter.year}`;

  // One settings section: header with its summary/unsaved badge, the fields, and its own Save.
  const settingsSection = (section: SettingsSection, body: ReactNode) => {
    const dirty = isDirty(section);
    const saving = savingSection === section.id;

    return (
      <AccordionItem value={section.id} className={ITEM_CLASS}>
        <AccordionTrigger className={TRIGGER_CLASS}>
          <SectionHeader
            icon={section.icon}
            title={section.title}
            summary={summaries[section.id]}
            dirty={dirty}
          />
        </AccordionTrigger>

        <AccordionContent className={CONTENT_CLASS}>
          <p className="mb-5 text-sm text-muted-foreground">
            {section.description}
          </p>

          {saved ? (
            <>
              {body}

              <div className="mt-6 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                {dirty && (
                  <Button
                    variant="ghost"
                    onClick={() => discardSection(section)}
                    disabled={saving}
                  >
                    Discard
                  </Button>
                )}

                <Button
                  onClick={() => saveSection(section)}
                  disabled={!dirty || saving}
                  className="min-w-[140px]"
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </>
          ) : scheduleLoadFailed ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              Couldn't load the work schedule.
              <Button variant="outline" size="sm" onClick={fetchSchedule}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}
        </AccordionContent>
      </AccordionItem>
    );
  };

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* ================= PAGE HEADER ================= */}
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">
            Configure Attendance System
          </h1>

          <p className="text-muted-foreground">
            Manage work schedules, weekly holidays, job titles and custom holidays.
            Each section saves on its own.
          </p>
        </div>

        {/* ================= WORK SCHEDULE ================= */}
        <section className="space-y-3">
          <h2 className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Work Schedule
          </h2>

          <Accordion type="multiple" defaultValue={["hours"]} className="space-y-3">

            {/* WORKING HOURS & BREAKS */}
            {settingsSection(
              SECTIONS.hours,
              <div className="grid gap-6 md:grid-cols-2">
                <Field
                  id="cfg-full-day"
                  label="Full Day Hours"
                  hint="Minimum hours required for full day attendance."
                >
                  <Input
                    id="cfg-full-day"
                    type="number"
                    value={schedule.fullDayHours}
                    onChange={(e) => setField("fullDayHours", Number(e.target.value))}
                  />
                </Field>

                <Field
                  id="cfg-half-day"
                  label="Half Day Hours"
                  hint="Minimum hours required for half day attendance."
                >
                  <Input
                    id="cfg-half-day"
                    type="number"
                    value={schedule.halfDayHours}
                    onChange={(e) => setField("halfDayHours", Number(e.target.value))}
                  />
                </Field>

                <Field
                  id="cfg-ot-threshold"
                  label="Overtime Threshold"
                  hint="Overtime starts after these many hours."
                >
                  <Input
                    id="cfg-ot-threshold"
                    type="number"
                    value={schedule.overtimeThreshold}
                    onChange={(e) => setField("overtimeThreshold", Number(e.target.value))}
                  />
                </Field>

                <Field
                  id="cfg-break"
                  label="Break Duration (min)"
                  hint="Length of the single daily break. At most one break is deducted per day, however long the shift. Set 0 to disable."
                >
                  <Input
                    id="cfg-break"
                    type="number"
                    min={0}
                    max={480}
                    step={15}
                    value={schedule.breakDurationMinutes}
                    onChange={(e) => setField("breakDurationMinutes", Number(e.target.value))}
                  />
                </Field>

                <Field
                  id="cfg-break-min"
                  label="Break After (hours)"
                  hint="An employee who works at least this many hours in a day gets one break deducted; less than this, none. Leave empty to use Full Day Hours."
                >
                  <Input
                    id="cfg-break-min"
                    type="number"
                    min={0.5}
                    max={24}
                    step={0.5}
                    value={schedule.breakMinHours ?? ""}
                    onChange={(e) =>
                      setField("breakMinHours", e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                </Field>
              </div>
            )}

            {/* WEEKLY OFF DAYS */}
            {settingsSection(
              SECTIONS.weekly,
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {days.map((day) => (
                  <label
                    key={day}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors ${schedule.weeklyHolidays.includes(day)
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                      }`}
                  >
                    <Checkbox
                      checked={schedule.weeklyHolidays.includes(day)}
                      onCheckedChange={(checked) =>
                        setField(
                          "weeklyHolidays",
                          checked
                            ? [...schedule.weeklyHolidays, day]
                            : schedule.weeklyHolidays.filter((d) => d !== day)
                        )
                      }
                    />

                    <span className="capitalize font-medium">
                      {day}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {/* CHECK-OUT RULES */}
            {settingsSection(
              SECTIONS.checkout,
              <div className="grid gap-6 md:grid-cols-2">
                <Field
                  id="cfg-reminder-time"
                  label="Check-out Reminder Time"
                  hint="Push reminder sent after this time for open check-outs the auto-checkout won't close (e.g. a category with no default set). Clear to disable."
                >
                  <Input
                    id="cfg-reminder-time"
                    type="time"
                    value={schedule.checkoutReminderTime ?? ""}
                    onChange={(e) => setField("checkoutReminderTime", e.target.value)}
                  />
                </Field>

                <Field
                  id="cfg-remark-grace"
                  label="Check-out Remark Grace (min)"
                  hint="When editing attendance, a supervisor remark is required if a check-out runs more than this many minutes past the employee's category default check-out. Set 0 to require a remark for any overrun."
                >
                  <Input
                    id="cfg-remark-grace"
                    type="number"
                    min={0}
                    max={240}
                    step={5}
                    value={schedule.checkoutRemarkGraceMinutes ?? 15}
                    onChange={(e) => setField("checkoutRemarkGraceMinutes", Number(e.target.value))}
                  />
                </Field>
              </div>
            )}

            {/* LOSS OF PAY */}
            {settingsSection(
              SECTIONS.leave,
              <div className="grid gap-6 md:grid-cols-2">
                <Field
                  id="cfg-lop-amount"
                  label="LOP Deduction Amount (OMR)"
                  hint={<>When an absent day is marked LOP (Loss of Pay), its remark is auto-filled with "Deduct &lt;this amount&gt; OMR" and shown in the timesheet. Purely an annotation — no pay is calculated.</>}
                >
                  <Input
                    id="cfg-lop-amount"
                    type="number"
                    min={0}
                    step={0.5}
                    value={schedule.lopDeductionAmount ?? 3.5}
                    onChange={(e) => setField("lopDeductionAmount", Number(e.target.value))}
                  />
                </Field>
              </div>
            )}

            {/* SUPERVISOR BACKFILL */}
            {settingsSection(
              SECTIONS.backfill,
              <div className="grid gap-6 md:grid-cols-2">
                <Field
                  id="cfg-backfill-window"
                  label="Backfill Window (days)"
                  hint={<>Supervisors can backfill yesterday back to this many days ago (never today), and must send a draft for approval while its day is still inside the window. At most {MAX_SUPERVISOR_BACKFILL_WINDOW_DAYS} days.</>}
                >
                  <Input
                    id="cfg-backfill-window"
                    type="number"
                    min={1}
                    max={MAX_SUPERVISOR_BACKFILL_WINDOW_DAYS}
                    step={1}
                    value={schedule.supervisorBackfillWindowDays ?? DEFAULT_SUPERVISOR_BACKFILL_WINDOW_DAYS}
                    onChange={(e) => setField("supervisorBackfillWindowDays", Number(e.target.value))}
                  />
                </Field>
              </div>
            )}

            {/* ERPNEXT EXPORT */}
            {settingsSection(
              SECTIONS.erp,
              <div className="grid gap-6 md:grid-cols-2">
                <Field
                  id="cfg-erp-company"
                  label="ERPNext Company Name"
                  hint={<>Fills the Company column on the ERPNext Attendance &amp; Timesheet export files. Must match the Company name in ERPNext.</>}
                >
                  <Input
                    id="cfg-erp-company"
                    type="text"
                    value={schedule.erpCompanyName ?? ""}
                    onChange={(e) => setField("erpCompanyName", e.target.value)}
                  />
                </Field>

                <Field
                  id="cfg-erp-activity"
                  label="ERPNext Activity Type"
                  hint="Fallback for employees with no allocated activity type (Activity Types page): stamped on their regular Timesheet time-logs in the ERPNext export."
                >
                  <Input
                    id="cfg-erp-activity"
                    type="text"
                    value={schedule.erpDefaultActivityType ?? ""}
                    onChange={(e) => setField("erpDefaultActivityType", e.target.value)}
                  />
                </Field>

                <Field
                  id="cfg-erp-ot-activity"
                  label="ERPNext Overtime Activity Type"
                  hint="Fallback for employees with no allocated activity type. When set, their Timesheet lines are split into a regular line (above) and a separate overtime line under this Activity Type, so OT can be costed at a premium in ERPNext. Leave blank to put all their hours on the regular Activity Type. Allocated employees always use their type's automatic overtime type."
                >
                  <Input
                    id="cfg-erp-ot-activity"
                    type="text"
                    value={schedule.erpOvertimeActivityType ?? ""}
                    onChange={(e) => setField("erpOvertimeActivityType", e.target.value)}
                  />
                </Field>

                <Field
                  id="cfg-erp-ot-type"
                  label="ERPNext Overtime Type"
                  hint="Must match an Overtime Type in ERPNext. When set, overtime hours are written onto each Attendance row (actual_overtime_duration) so payroll can consume them. Worked holidays are written the same way, with their holiday hours. Leave blank to omit overtime (and worked-holiday hours) from the Attendance export."
                >
                  <Input
                    id="cfg-erp-ot-type"
                    type="text"
                    value={schedule.erpOvertimeType ?? ""}
                    onChange={(e) => setField("erpOvertimeType", e.target.value)}
                  />
                </Field>

                <Field
                  id="cfg-erp-leave-type"
                  label="ERPNext Paid Leave Type"
                  hint={`ERPNext Leave Type for approved PAID (annual) leave — those days export as "On Leave" with this type. Sick leave and LOP are unpaid, so they export as plain "Absent". Must match a Leave Type in ERPNext.`}
                >
                  <Input
                    id="cfg-erp-leave-type"
                    type="text"
                    value={schedule.erpPaidLeaveType ?? ""}
                    onChange={(e) => setField("erpPaidLeaveType", e.target.value)}
                  />
                </Field>

                {isSuperadmin && (
                  <Field
                    id="cfg-ot-activity-multiplier"
                    label="Overtime Activity Multiplier"
                    hint={`Every activity type gets an automatic "- Overtime" type whose costing and billing rates are the type's rates × this (default ${DEFAULT_OVERTIME_MULTIPLIER}). Changing it re-rates every overtime type — re-import the Activity Types master CSV into ERPNext afterwards.`}
                  >
                    <Input
                      id="cfg-ot-activity-multiplier"
                      type="number"
                      min={MIN_OVERTIME_MULTIPLIER}
                      max={MAX_OVERTIME_MULTIPLIER}
                      step={0.05}
                      value={schedule.overtimeActivityMultiplier ?? ""}
                      onChange={(e) => setField("overtimeActivityMultiplier", Number(e.target.value))}
                    />
                  </Field>
                )}

                {/* Unmarked days never reach the ERPNext file, so ERPNext applies its own
                    rule to them — this mirrors it so the report's Payment Days match the slip. */}
                <div className="flex items-start justify-between gap-4 rounded-lg border p-4 md:col-span-2">
                  <div className="space-y-1">
                    <label htmlFor="cfg-unmarked-absent" className="text-sm font-medium">
                      Count unmarked days as absent
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Match ERPNext Payroll Settings → "Consider Unmarked Attendance As". On (Absent):
                      days with no attendance record — up to yesterday, holidays excluded — are
                      deducted from Payment Days in the monthly report and the employee timesheet.
                      Off (Present): they count as paid.
                    </p>
                  </div>
                  <Switch
                    id="cfg-unmarked-absent"
                    checked={schedule.countUnmarkedAsAbsent}
                    onCheckedChange={(checked) => setField("countUnmarkedAsAbsent", checked)}
                  />
                </div>
              </div>
            )}
          </Accordion>
        </section>

        {/* ================= LISTS (changes apply immediately) ================= */}
        <section className="space-y-3">
          <h2 className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Lists
          </h2>

          <Accordion type="multiple" className="space-y-3">

            {/* JOB TITLES */}
            <AccordionItem value="jobTitles" className={ITEM_CLASS}>
              <AccordionTrigger className={TRIGGER_CLASS}>
                <SectionHeader
                  icon={Briefcase}
                  title="Job Titles"
                  summary={jobTitlesSummary}
                />
              </AccordionTrigger>

              <AccordionContent className={`${CONTENT_CLASS} space-y-6`}>
                <p className="text-sm text-muted-foreground">
                  Changes here apply immediately.
                </p>

                {/* Add Job Title */}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    placeholder="Enter job title"
                    value={jobTitleInput}
                    onChange={(e) =>
                      setJobTitleInput(e.target.value)
                    }
                  />

                  <Select
                    value={newTitleCollar}
                    onValueChange={(v) => setNewTitleCollar(v as CollarType)}
                  >
                    <SelectTrigger className="sm:w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skilled">Skilled Labour</SelectItem>
                      <SelectItem value="staff">Staff</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button onClick={addJobTitle} disabled={addingJobTitle}>
                    {addingJobTitle ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                  </Button>
                </div>

                <p className="-mt-3 text-xs text-muted-foreground">
                  Staff (white-collar) titles are excluded from site man-hours &amp;
                  man-days stats and use the site's staff default shift times.
                </p>

                {/* Existing Job Titles */}
                <div>
                  <h3 className="mb-3 font-medium">
                    Existing Job Titles
                  </h3>

                  <div className="max-h-64 overflow-y-auto rounded-md border">
                    {filteredJobTitles.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground">
                        No job titles found
                      </div>
                    ) : (
                      <div className="divide-y">
                        {filteredJobTitles.map((job) => (
                          <div
                            key={job._id}
                            className="flex items-center justify-between gap-3 px-4 py-3"
                          >
                            <span className="truncate">{job.title}</span>

                            <div className="flex items-center gap-2">
                              {/* Skilled Labour / Staff segmented toggle */}
                              <div className="inline-flex overflow-hidden rounded-md border">
                                {(["skilled", "staff"] as CollarType[]).map((c) => {
                                  const active = (job.collarType ?? "skilled") === c;
                                  return (
                                    <button
                                      key={c}
                                      type="button"
                                      disabled={active || updatingCollarId === job._id}
                                      onClick={() => updateTitleCollar(job._id, c)}
                                      className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                                        active
                                          ? "bg-primary text-primary-foreground"
                                          : "bg-transparent text-muted-foreground hover:bg-muted"
                                      } disabled:cursor-default`}
                                    >
                                      {c === "skilled" ? "Skilled" : "Staff"}
                                    </button>
                                  );
                                })}
                              </div>

                              <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="text-red-500 hover:text-red-600"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>

                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Delete Job Title?
                                  </AlertDialogTitle>

                                  <AlertDialogDescription>
                                    This will permanently remove "
                                    {job.title}".
                                  </AlertDialogDescription>
                                </AlertDialogHeader>

                                <AlertDialogFooter>
                                  <AlertDialogCancel>
                                    Cancel
                                  </AlertDialogCancel>

                                  <AlertDialogAction
                                    onClick={() =>
                                      deleteJobTitle(job._id)
                                    }
                                    disabled={deletingJobTitle === job._id}
                                  >
                                    {deletingJobTitle === job._id ? "Deleting..." : "Delete"}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* CUSTOM HOLIDAYS */}
            <AccordionItem value="holidays" className={ITEM_CLASS}>
              <AccordionTrigger className={TRIGGER_CLASS}>
                <SectionHeader
                  icon={CalendarDays}
                  title="Custom Holidays"
                  summary={holidaysSummary}
                />
              </AccordionTrigger>

              <AccordionContent className={`${CONTENT_CLASS} space-y-6`}>
                <p className="text-sm text-muted-foreground">
                  Add, view, and manage custom holidays. Changes here apply immediately.
                </p>

                {/* ADD NEW HOLIDAY FORM */}
                <div className="rounded-xl border p-4 bg-muted/20 space-y-3">
                  <h3 className="text-sm font-semibold tracking-tight text-foreground">
                    Add New Holiday
                  </h3>
                  <div className="grid gap-4 md:grid-cols-[220px_1fr_auto]">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        Date
                      </label>
                      <Input
                        type="date"
                        value={holidayForm.date}
                        onChange={(e) =>
                          setHolidayForm({
                            ...holidayForm,
                            date: e.target.value,
                          })
                        }
                        className="bg-background"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        Reason
                      </label>
                      <Input
                        placeholder="Example: Independence Day"
                        value={holidayForm.reason}
                        onChange={(e) =>
                          setHolidayForm({
                            ...holidayForm,
                            reason: e.target.value,
                          })
                        }
                        className="bg-background"
                      />
                    </div>

                    <div className="flex items-end">
                      <Button
                        onClick={addHoliday}
                        disabled={addingHoliday}
                        className="w-full md:w-auto min-w-[120px]"
                      >
                        {addingHoliday && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {addingHoliday ? "Adding..." : "Add Holiday"}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* HOLIDAYS LIST */}
                <div className="space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="font-medium">
                      Holidays in {filterMonthLabel} {filter.year}
                    </h3>

                    {/* FILTERS */}
                    <div className="flex gap-3">
                      <Select
                        value={filter.month.toString()}
                        onValueChange={(val) =>
                          setFilter({
                            ...filter,
                            month: Number(val),
                          })
                        }
                      >
                        <SelectTrigger className="flex-1 bg-background sm:w-[180px] sm:flex-none">
                          <SelectValue placeholder="Select month" />
                        </SelectTrigger>

                        <SelectContent>
                          {months.map((m) => (
                            <SelectItem
                              key={m.value}
                              value={m.value.toString()}
                            >
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Input
                        type="number"
                        value={filter.year}
                        onChange={(e) =>
                          setFilter({
                            ...filter,
                            year: Number(e.target.value),
                          })
                        }
                        className="w-[120px]"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-6">
                            Date
                          </TableHead>
                          <TableHead>
                            Reason
                          </TableHead>
                          <TableHead className="w-[140px]">
                            Action
                          </TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {holidays.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={3}
                              className="h-40 text-center text-muted-foreground"
                            >
                              No holidays configured for this month
                            </TableCell>
                          </TableRow>
                        ) : (
                          holidays.map((h) => (
                            <TableRow key={h._id}>
                              <TableCell className="pl-6 font-medium">
                                {new Date(h.date).toLocaleDateString(
                                  "en-IN",
                                  {
                                    weekday: "short",
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric",
                                  }
                                )}
                              </TableCell>

                              <TableCell>
                                {h.reason}
                              </TableCell>

                              <TableCell>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => {
                                    setHolidayToDelete(h);
                                    setIsDeleteConfirmOpen(true);
                                  }}
                                  className="min-w-[70px]"
                                >
                                  Delete
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>

        {/* DELETE HOLIDAY CONFIRMATION DIALOG */}
        <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the custom holiday{" "}
                <span className="font-semibold text-foreground">
                  "{holidayToDelete?.reason}"
                </span>{" "}
                on{" "}
                {holidayToDelete &&
                  new Date(holidayToDelete.date).toLocaleDateString("en-IN", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                . This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setHolidayToDelete(null)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 animate-none"
                onClick={() => {
                  if (holidayToDelete) {
                    deleteHoliday(holidayToDelete._id);
                  }
                }}
                disabled={deletingHoliday === holidayToDelete?._id}
              >
                {deletingHoliday === holidayToDelete?._id ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Deleting...
                  </span>
                ) : (
                  "Delete"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useWorkConfig } from "@/context/WorkConfigContext";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Loader2 } from "lucide-react";

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
  overtimeMultiplier: number;
  monthlyHoursDivisor: number;
  weeklyHolidays: string[];
  breakDurationMinutes: number;
};


type Holiday = {
  _id: string;
  date: string;
  reason: string;
};

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

export default function Configure() {
  const { refreshConfig } = useWorkConfig();

  const [schedule, setSchedule] = useState<WorkSchedule>({
    fullDayHours: 8,
    halfDayHours: 4,
    overtimeThreshold: 8,
    overtimeMultiplier: 1.25,
    monthlyHoursDivisor: 240,
    weeklyHolidays: [],
    breakDurationMinutes: 60,
  });

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
  const [updatingSchedule, setUpdatingSchedule] = useState(false);
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
      const res = await api.get("/api/config");
      setSchedule(res.data.data);
    } catch {
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
  const updateSchedule = async () => {
    try {
      setUpdatingSchedule(true);
      // The night-shift cutoff is per-site now (derived from each site's default shift
      // times), so it is no longer part of this form's payload.
      const res = await api.patch("/api/config/update", {
        fullDayHours: schedule.fullDayHours,
        halfDayHours: schedule.halfDayHours,
        overtimeThreshold: schedule.overtimeThreshold,
        overtimeMultiplier: schedule.overtimeMultiplier,
        monthlyHoursDivisor: schedule.monthlyHoursDivisor,
        weeklyHolidays: schedule.weeklyHolidays,
        breakDurationMinutes: schedule.breakDurationMinutes,
      });

      if (res.data?.data) setSchedule(res.data.data);
      await refreshConfig();

      toast.success(res.data?.message || "Work schedule updated successfully");
    } catch (err: any) {
      const body = err?.response?.data;
      toast.error(body?.message || "Failed to update work schedule", {
        duration: 8000,
      });
      fetchSchedule();
    } finally {
      setUpdatingSchedule(false);
    }
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

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* ================= PAGE HEADER ================= */}
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">
            Configure Attendance System
          </h1>

          <p className="text-muted-foreground">
            Manage work schedules, weekly holidays, and custom holidays.
          </p>
        </div>

        {/* ================= WORK SCHEDULE ================= */}
        <Card className="border-none shadow-sm">
          <CardHeader className="border-b bg-muted/40">
            <CardTitle className="text-xl">
              Work Schedule
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-8 p-6">

            {/* SHIFT HOURS */}
            {/* WORK HOURS CONFIG */}
            <div className="space-y-6">

              <div>
                <h3 className="font-medium">
                  Work Configuration
                </h3>

                <p className="text-sm text-muted-foreground">
                  Configure attendance thresholds and overtime settings.
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">

                {/* FULL DAY HOURS */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Full Day Hours
                  </label>

                  <Input
                    type="number"
                    value={schedule.fullDayHours}
                    onChange={(e) =>
                      setSchedule({
                        ...schedule,
                        fullDayHours: Number(e.target.value),
                      })
                    }
                  />

                  <p className="text-xs text-muted-foreground">
                    Minimum hours required for full day attendance.
                  </p>
                </div>

                {/* HALF DAY HOURS */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Half Day Hours
                  </label>

                  <Input
                    type="number"
                    value={schedule.halfDayHours}
                    onChange={(e) =>
                      setSchedule({
                        ...schedule,
                        halfDayHours: Number(e.target.value),
                      })
                    }
                  />

                  <p className="text-xs text-muted-foreground">
                    Minimum hours required for half day attendance.
                  </p>
                </div>

                {/* OT THRESHOLD */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Overtime Threshold
                  </label>

                  <Input
                    type="number"
                    value={schedule.overtimeThreshold}
                    onChange={(e) =>
                      setSchedule({
                        ...schedule,
                        overtimeThreshold: Number(e.target.value),
                      })
                    }
                  />

                  <p className="text-xs text-muted-foreground">
                    Overtime starts after these many hours.
                  </p>
                </div>

                {/* OT MULTIPLIER */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    OT Rate Multiplier
                  </label>

                  <Input
                    type="number"
                    min={0}
                    step={0.05}
                    value={schedule.overtimeMultiplier}
                    onChange={(e) =>
                      setSchedule({
                        ...schedule,
                        overtimeMultiplier: Number(e.target.value),
                      })
                    }
                  />

                  <p className="text-xs text-muted-foreground">
                    Overtime is paid at this multiple of the employee's normal hourly rate.
                    e.g. 1.25 = 125%.
                  </p>
                </div>

                {/* MONTHLY HOURS */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Monthly Hours
                  </label>

                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={schedule.monthlyHoursDivisor}
                    onChange={(e) =>
                      setSchedule({
                        ...schedule,
                        monthlyHoursDivisor: Number(e.target.value),
                      })
                    }
                  />

                  <p className="text-xs text-muted-foreground">
                    Hours per month used to derive an employee's normal hourly rate from
                    their monthly salary.
                  </p>
                </div>

                {/* BREAK DURATION */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Break Duration (min)
                  </label>

                  <Input
                    type="number"
                    min={0}
                    max={480}
                    step={15}
                    value={schedule.breakDurationMinutes}
                    onChange={(e) =>
                      setSchedule({
                        ...schedule,
                        breakDurationMinutes: Number(e.target.value),
                      })
                    }
                  />

                  <p className="text-xs text-muted-foreground">
                    Duration of one break in minutes. 1 break is deducted per full day worked (e.g. 16h shift = 2 breaks). Set 0 to disable.
                  </p>
                </div>

              </div>
            </div>

            {/* WEEKLY HOLIDAYS */}
            <div className="space-y-4">
              <div>
                <h3 className="font-medium">
                  Weekly Holidays
                </h3>

                <p className="text-sm text-muted-foreground">
                  Select recurring weekly off days.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {days.map((day) => (
                  <div
                    key={day}
                    className={`flex items-center gap-3 rounded-xl border p-4 transition-colors ${schedule.weeklyHolidays.includes(day)
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                      }`}
                  >
                    <Checkbox
                      checked={schedule.weeklyHolidays.includes(day)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSchedule({
                            ...schedule,
                            weeklyHolidays: [
                              ...schedule.weeklyHolidays,
                              day,
                            ],
                          })
                        } else {
                          setSchedule({
                            ...schedule,
                            weeklyHolidays:
                              schedule.weeklyHolidays.filter(
                                (d) => d !== day
                              ),
                          })
                        }
                      }}
                    />

                    <span className="capitalize font-medium">
                      {day}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* NIGHT SHIFT SETTINGS (informational) */}
            <div className="space-y-4">
              <div>
                <h3 className="font-medium flex items-center gap-2">
                  <span>🌙</span> Night Shift Settings
                </h3>

                <p className="text-sm text-muted-foreground">
                  Night shifts need no global configuration.
                </p>
              </div>

              <div className="rounded-md border bg-muted/20 p-4 space-y-2">
                <p className="text-sm">
                  A shift is recorded on the day it{" "}
                  <span className="font-medium">starts</span>. When a shift runs past
                  midnight, its check-out is simply marked as belonging to the next day —
                  so a site's day and night shift times can overlap freely and shifts of
                  any length are supported.
                </p>
                <p className="text-xs text-muted-foreground">
                  A night shift left un-checked-out appears on the next day's roster for
                  that site as a <span className="font-medium">carryover</span>, so the
                  supervisor can enter the real check-out time before marking that
                  employee for the new day.
                </p>
              </div>
            </div>

            {/* SAVE BUTTON */}
            <div className="flex justify-end border-t pt-6">
              <Button
                onClick={updateSchedule}
                disabled={updatingSchedule}
                className="min-w-[160px]"
              >
                {updatingSchedule && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {updatingSchedule ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </CardContent>
        </Card>
        
        {/* jobtitle */}
        <Card className="border-none shadow-sm">
          <CardHeader className="border-b bg-muted/40">
            <CardTitle className="text-xl">
              Job Titles
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-6 p-6">

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

          </CardContent>
        </Card>

        {/* ================= CUSTOM HOLIDAYS ================= */}
        <Card className="border-none shadow-sm">
          <CardHeader className="border-b bg-muted/40">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-xl">
                  Custom Holidays
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add, view, and manage custom holidays.
                </p>
              </div>

              {/* FILTERS */}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Select
                  value={filter.month.toString()}
                  onValueChange={(val) =>
                    setFilter({
                      ...filter,
                      month: Number(val),
                    })
                  }
                >
                  <SelectTrigger className="w-[180px] bg-background">
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
          </CardHeader>

          <CardContent className="space-y-6 p-6">
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

            {/* HOLIDAYS LIST TABLE */}
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
          </CardContent>
        </Card>

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
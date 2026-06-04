import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { X } from "lucide-react";

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
  overtimeRatePerHour: number;
  weeklyHolidays: string[];
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
  const [schedule, setSchedule] = useState<WorkSchedule>({
    fullDayHours: 8,
    halfDayHours: 4,
    overtimeThreshold: 8,
    overtimeRatePerHour: 0,
    weeklyHolidays: [],
  });

  const [holidayForm, setHolidayForm] = useState({
    date: "",
    reason: "",
  });

  type jobTitle = {
    _id: string,
    title: string
  }

  const [jobTitles, setJobtitles] = useState<jobTitle[]>([])

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [filter, setFilter] = useState(getCurrentMonthYear());

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
      await api.patch("/api/config/update", {
        fullDayHours: schedule.fullDayHours,
        halfDayHours: schedule.halfDayHours,
        overtimeThreshold: schedule.overtimeThreshold,
        overtimeRatePerHour:
          schedule.overtimeRatePerHour,
        weeklyHolidays: schedule.weeklyHolidays,
      });

      toast.success("Work schedule updated successfully");
    } catch (err) {
      toast.error("Failed to update work schedule");
    }
  };

  const addHoliday = async () => {
    try {
      await api.post("/api/config/custom-holidays", holidayForm);

      setHolidayForm({ date: "", reason: "" });
      fetchHolidays();

      toast.success("Holiday added successfully");
    } catch (err) {
      toast.error("Failed to add holiday");
    }
  };

  const deleteHoliday = async (id: string) => {
    try {
      await api.delete(`/api/config/custom-holidays/${id}`);

      fetchHolidays();

      toast.success("Holiday deleted successfully");
    } catch (err) {
      toast.error("Failed to delete holiday");
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

      await api.post("/api/employees/jobTitles", {
        title: formattedTitle,
      });

      toast.success("Job title added");

      setJobTitleInput("");

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
    }
  };

  const deleteJobTitle = async (id: string) => {
    try {
      await api.delete(`/api/employees/jobTitles/${id}`);

      toast.success("Job title deleted");

      fetchJobTitles();
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
        "Failed to delete job title"
      );
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

                {/* OT RATE */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    OT Rate Per Hour
                  </label>

                  <Input
                    type="number"
                    value={schedule.overtimeRatePerHour}
                    onChange={(e) =>
                      setSchedule({
                        ...schedule,
                        overtimeRatePerHour: Number(e.target.value),
                      })
                    }
                  />

                  <p className="text-xs text-muted-foreground">
                    Overtime pay amount per hour.
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

            {/* SAVE BUTTON */}
            <div className="flex justify-end border-t pt-6">
              <Button
                onClick={updateSchedule}
                className="min-w-[160px]"
              >
                Save Changes
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
            <div className="flex gap-3">
              <Input
                placeholder="Enter job title"
                value={jobTitleInput}
                onChange={(e) =>
                  setJobTitleInput(e.target.value)
                }
              />

              <Button onClick={addJobTitle}>
                Add
              </Button>
            </div>

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
                        className="flex items-center justify-between px-4 py-3"
                      >
                        <span>{job.title}</span>

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
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </CardContent>
        </Card>

        {/* ================= ADD HOLIDAY ================= */}
        <Card className="border-none shadow-sm">
          <CardHeader className="border-b bg-muted/40">
            <CardTitle className="text-xl">
              Add Custom Holiday
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-5 p-6">

            <div className="grid gap-4 md:grid-cols-[220px_1fr_auto]">
              <div className="space-y-2">
                <label className="text-sm font-medium">
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
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
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
                />
              </div>

              <div className="flex items-end">
                <Button
                  onClick={addHoliday}
                  className="w-full md:w-auto"
                >
                  Add Holiday
                </Button>
              </div>
            </div>

          </CardContent>
        </Card>

        {/* ================= HOLIDAY TABLE ================= */}
        <Card className="border-none shadow-sm">
          <CardHeader className="border-b bg-muted/40">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

              <div>
                <CardTitle className="text-xl">
                  Custom Holidays
                </CardTitle>

                <p className="mt-1 text-sm text-muted-foreground">
                  View and manage configured holidays.
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

          <CardContent className="p-0">
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
                          onClick={() =>
                            deleteHoliday(h._id)
                          }
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
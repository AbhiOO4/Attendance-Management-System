import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Employee = {
  id: string;
  empId: string;
  name: string;
  jobTitle: string;
  site: string;
};

const employees: Employee[] = [
  {
    id: "1",
    empId: "EMP001",
    name: "Arjun",
    jobTitle: "Electrician",
    site: "Site A",
  },
  {
    id: "2",
    empId: "EMP002",
    name: "Rahul",
    jobTitle: "Helper",
    site: "Site A",
  },
  {
    id: "3",
    empId: "EMP003",
    name: "Vishnu",
    jobTitle: "Supervisor",
    site: "Site A",
  },
  {
    id: "4",
    empId: "EMP004",
    name: "Akhil",
    jobTitle: "Welder",
    site: "Site B",
  },
];

const FULLDAY_HOURS = 8;
const HALFDAY_HOURS = 4;

const calculateHours = (
  checkIn: string,
  checkOut: string
) => {
  if (!checkIn || !checkOut) return 0;

  const inTime = new Date(
    `2025-01-01T${checkIn}`
  );

  const outTime = new Date(
    `2025-01-01T${checkOut}`
  );

  return (
    (outTime.getTime() -
      inTime.getTime()) /
    (1000 * 60 * 60)
  );
};

const calculateStatus = (
  hours: number
) => {
  if (hours >= FULLDAY_HOURS)
    return "fullday";

  if (hours >= HALFDAY_HOURS)
    return "halfday";

  return "absent";
};

export default function DummyAttendance1() {
  const [site] = useState("Site A");

  const [search, setSearch] =
    useState("");

  const [locked, setLocked] =
    useState(false);

  const [records, setRecords] =
    useState<
      Record<
        string,
        {
          checkIn: string;
          checkOut: string;
          ot: string;
        }
      >
    >({});

  const filteredEmployees = useMemo(() => {
    return employees
      .filter(
        (emp) =>
          emp.site === site
      )
      .filter((emp) => {
        const q =
          search.toLowerCase();

        return (
          emp.name
            .toLowerCase()
            .includes(q) ||
          emp.empId
            .toLowerCase()
            .includes(q) ||
          emp.jobTitle
            .toLowerCase()
            .includes(q)
        );
      })
      .sort((a, b) =>
        a.name.localeCompare(b.name)
      );
  }, [search, site]);

  const handleChange = (
    empId: string,
    field: string,
    value: string
  ) => {
    setRecords((prev) => ({
      ...prev,
      [empId]: {
        ...prev[empId],
        [field]: value,
      },
    }));
  };

  const handleSave = () => {
    setLocked(true);
  };

  return (
    <div className="min-h-screen bg-muted/30 p-4">
      <div className="mx-auto max-w-6xl space-y-4">

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              Bulk Attendance
            </h1>

            <p className="text-sm text-muted-foreground">
              Site Based Attendance
            </p>
          </div>

          <div className="flex gap-2">
            {locked ? (
              <Button
                variant="outline"
                onClick={() =>
                  setLocked(false)
                }
              >
                Edit
              </Button>
            ) : (
              <Button
                onClick={handleSave}
              >
                Save Attendance
              </Button>
            )}
          </div>
        </div>

        <Input
          placeholder="Search by employee name, ID or job title"
          value={search}
          onChange={(e) =>
            setSearch(e.target.value)
          }
        />

        <div className="space-y-3">
          {filteredEmployees.map(
            (employee) => {
              const record =
                records[
                  employee.id
                ] || {
                  checkIn: "",
                  checkOut: "",
                  ot: "",
                };

              const hours =
                calculateHours(
                  record.checkIn,
                  record.checkOut
                );

              const status =
                calculateStatus(
                  hours
                );

              return (
                  <Card
                      key={employee.id}
                      className="space-y-4 p-4 lg:space-y-0"
                  >

                      {/* MOBILE LAYOUT */}
                      <div className="space-y-4 lg:hidden">

                          <div>
                              <h3 className="font-semibold">
                                  {employee.name}
                              </h3>

                              <p className="text-sm text-muted-foreground">
                                  {employee.empId} •{" "}
                                  {employee.jobTitle}
                              </p>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                              <div>
                                  <label className="text-sm">
                                      Check In
                                  </label>

                                  <Input
                                      type="time"
                                      disabled={locked}
                                      value={record.checkIn}
                                      onChange={(e) =>
                                          handleChange(
                                              employee.id,
                                              "checkIn",
                                              e.target.value
                                          )
                                      }
                                  />
                              </div>

                              <div>
                                  <label className="text-sm">
                                      Check Out
                                  </label>

                                  <Input
                                      type="time"
                                      disabled={locked}
                                      value={record.checkOut}
                                      onChange={(e) =>
                                          handleChange(
                                              employee.id,
                                              "checkOut",
                                              e.target.value
                                          )
                                      }
                                  />
                              </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                              <div>
                                  <label className="text-sm">
                                      OT Hours
                                  </label>

                                  <Input
                                      type="number"
                                      disabled={locked}
                                      value={record.ot}
                                      onChange={(e) =>
                                          handleChange(
                                              employee.id,
                                              "ot",
                                              e.target.value
                                          )
                                      }
                                  />
                              </div>

                              <div>
                                  <label className="text-sm">
                                      Status
                                  </label>

                                  <div className="flex h-10 items-center rounded-md border px-3 text-sm font-medium capitalize">
                                      {status}
                                  </div>
                              </div>
                          </div>

                          <div className="text-sm text-muted-foreground">
                              Worked Hours:{" "}
                              {hours > 0
                                  ? hours.toFixed(2)
                                  : 0}
                          </div>
                      </div>

                      {/* DESKTOP LAYOUT */}
                      <div className="hidden lg:grid lg:grid-cols-[220px_140px_140px_120px_120px_120px] lg:items-end lg:gap-4">

                          {/* EMPLOYEE */}
                          <div>
                              <h3 className="font-semibold">
                                  {employee.name}
                              </h3>

                              <p className="text-sm text-muted-foreground">
                                  {employee.empId} •{" "}
                                  {employee.jobTitle}
                              </p>
                          </div>

                          {/* CHECK IN */}
                          <div>
                              <label className="mb-1 block text-sm">
                                  Check In
                              </label>

                              <Input
                                  type="time"
                                  disabled={locked}
                                  value={record.checkIn}
                                  onChange={(e) =>
                                      handleChange(
                                          employee.id,
                                          "checkIn",
                                          e.target.value
                                      )
                                  }
                              />
                          </div>

                          {/* CHECK OUT */}
                          <div>
                              <label className="mb-1 block text-sm">
                                  Check Out
                              </label>

                              <Input
                                  type="time"
                                  disabled={locked}
                                  value={record.checkOut}
                                  onChange={(e) =>
                                      handleChange(
                                          employee.id,
                                          "checkOut",
                                          e.target.value
                                      )
                                  }
                              />
                          </div>

                          {/* OT */}
                          <div>
                              <label className="mb-1 block text-sm">
                                  OT
                              </label>

                              <Input
                                  type="number"
                                  disabled={locked}
                                  value={record.ot}
                                  onChange={(e) =>
                                      handleChange(
                                          employee.id,
                                          "ot",
                                          e.target.value
                                      )
                                  }
                              />
                          </div>

                          {/* STATUS */}
                          <div>
                              <label className="mb-1 block text-sm">
                                  Status
                              </label>

                              <div className="flex h-10 items-center rounded-md border px-3 text-sm font-medium capitalize">
                                  {status}
                              </div>
                          </div>

                          {/* HOURS */}
                          <div>
                              <label className="mb-1 block text-sm">
                                  Worked
                              </label>

                              <div className="flex h-10 items-center rounded-md border px-3 text-sm">
                                  {hours > 0
                                      ? hours.toFixed(2)
                                      : 0}{" "}
                                  hrs
                              </div>
                          </div>

                      </div>
                  </Card>
              );
            }
          )}
        </div>
      </div>
    </div>
  );
}
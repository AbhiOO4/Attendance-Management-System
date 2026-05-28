import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";

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

export default function DummyAttendance2() {
  const [site] = useState("Site A");

  const [search, setSearch] =
    useState("");

  const [records, setRecords] =
    useState<
      Record<
        string,
        {
          checkIn: string;
          checkOut: string;
          ot: string;
          saved: boolean;
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
        saved: false,
      },
    }));
  };

  const saveRecord = (
    empId: string
  ) => {
    setRecords((prev) => ({
      ...prev,
      [empId]: {
        ...prev[empId],
        saved: true,
      },
    }));

    toast.success(
      "Attendance saved"
    );
  };

  const unlockRecord = (
    empId: string
  ) => {
    setRecords((prev) => ({
      ...prev,
      [empId]: {
        ...prev[empId],
        saved: false,
      },
    }));
  };

  return (
    <div className="min-h-screen bg-muted/30 p-4">
      <div className="mx-auto max-w-6xl space-y-4">

        <div>
          <h1 className="text-2xl font-bold">
            Per Record Attendance
          </h1>

          <p className="text-sm text-muted-foreground">
            Site Based Attendance
          </p>
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
                  saved: false,
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
                  className="space-y-4 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">
                        {employee.name}
                      </h3>

                      <p className="text-sm text-muted-foreground">
                        {
                          employee.empId
                        }{" "}
                        •{" "}
                        {
                          employee.jobTitle
                        }
                      </p>
                    </div>

                    {record.saved ? (
                      <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                        Saved
                      </span>
                    ) : (
                      <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-700">
                        Pending
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm">
                        Check In
                      </label>

                      <Input
                        type="time"
                        disabled={
                          record.saved
                        }
                        value={
                          record.checkIn
                        }
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
                        disabled={
                          record.saved
                        }
                        value={
                          record.checkOut
                        }
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
                        disabled={
                          record.saved
                        }
                        value={
                          record.ot
                        }
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

                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      Worked Hours:{" "}
                      {hours > 0
                        ? hours.toFixed(
                            2
                          )
                        : 0}
                    </div>

                    {record.saved ? (
                      <Button
                        variant="outline"
                        onClick={() =>
                          unlockRecord(
                            employee.id
                          )
                        }
                      >
                        Edit
                      </Button>
                    ) : (
                      <Button
                        onClick={() =>
                          saveRecord(
                            employee.id
                          )
                        }
                      >
                        Save
                      </Button>
                    )}
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
import { useEffect, useState } from "react"
import { Check, ChevronsUpDown, Loader2 } from "lucide-react"

import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { EmployeeRef } from "@/lib/leave"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// Searchable picker over ACTIVE employees (server-side search on name / ID / job
// title, 20 at a time), for the Leave page's allocation and application forms.
export default function EmployeePicker({
  value,
  onChange,
  disabled,
  id,
}: {
  value: EmployeeRef | null
  onChange: (employee: EmployeeRef) => void
  disabled?: boolean
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<EmployeeRef[]>([])
  const [loading, setLoading] = useState(false)

  // Debounced search while the list is open.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await api.get("/api/employees", {
          params: { search: search.trim() || undefined, page: 1, limit: 20 },
        })
        if (!cancelled) setResults(res.data?.employees || [])
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [open, search])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {value ? (
            <span className="truncate">
              {value.name}{" "}
              <span className="text-muted-foreground">({value.employeeId})</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Select an employee</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-[280px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search name, ID or job title…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            ) : (
              <>
                <CommandEmpty>No employee found.</CommandEmpty>
                <CommandGroup>
                  {results.map((employee) => (
                    <CommandItem
                      key={employee._id}
                      value={employee._id}
                      onSelect={() => {
                        onChange(employee)
                        setOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value?._id === employee._id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="min-w-0">
                        <div className="truncate">{employee.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {employee.employeeId}
                          {employee.jobTitle ? ` · ${employee.jobTitle}` : ""}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

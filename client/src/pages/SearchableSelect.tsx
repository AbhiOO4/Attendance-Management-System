import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

type Job = {
  _id?: string
  title: string
}

type SearchableSelectProps = {
  jobs: Job[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export default function SearchableSelect({
  jobs,
  value,
  onChange,
  placeholder = "Select job title",
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between"
        >
          {value || placeholder}

          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-full p-0">
        <Command>
          <CommandInput placeholder="Search job title..." />

          <CommandList>
            <CommandEmpty>No job found.</CommandEmpty>

            <CommandGroup>
              {jobs.map((job) => (
                <CommandItem
                  key={job._id || job.title}
                  value={job.title}
                  onSelect={(currentValue) => {
                    onChange(currentValue)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === job.title
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />

                  {job.title}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
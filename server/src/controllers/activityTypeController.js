import mongoose from "mongoose"
import activityTypeModel from "../models/activityTypeModel.js"
import empModel from "../models/empModel.js"
import workModel from "../models/workModel.js"
import { escapeRegExp } from "../utils/escapeRegExp.js"
import { toCsv } from "../utils/erpnextExport.js"
import {
  ACTIVITY_NAME_MAX,
  OVERTIME_SUFFIX,
  hasOvertimeSuffix,
  resolveOvertimeMultiplier,
  round3,
  withOvertime,
} from "../utils/activityTypes.js"

// Activity types (utils/activityTypes.js): ERPNext rate bands allocated per employee.
// Every route is superadmin-only (activityTypeRoutes.js).

async function loadMultiplier() {
  const cfg = await workModel.findOne({ type: "default" }, "overtimeActivityMultiplier").lean()
  return resolveOvertimeMultiplier(cfg)
}

// A rate from the request body: a finite number ≥ 0 (rounded to 3dp), or null when invalid.
function parseRate(value) {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? round3(n) : null
}

// GET /api/activity-types — every type with its derived overtime twin and how many active
// employees are allocated to it, plus the multiplier.
export const getActivityTypes = async (req, res) => {
  try {
    const [types, multiplier, counts] = await Promise.all([
      activityTypeModel.find({}).sort({ name: 1 }).lean(),
      loadMultiplier(),
      empModel.aggregate([
        { $match: { activityType: { $ne: null }, isActive: true } },
        { $group: { _id: "$activityType", count: { $sum: 1 } } },
      ]),
    ])
    const countById = new Map(counts.map((c) => [String(c._id), c.count]))
    const data = types.map((t) => ({
      ...withOvertime(t, multiplier),
      allocatedCount: countById.get(String(t._id)) || 0,
    }))
    res.status(200).json({ success: true, data, multiplier })
  } catch (error) {
    console.log(error)
    res.status(500).json({ success: false, message: "Failed to fetch activity types" })
  }
}

// POST /api/activity-types { name, costingRate, billingRate }
export const createActivityType = async (req, res) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim().replace(/\s+/g, " ") : ""
    const costingRate = parseRate(req.body?.costingRate)
    const billingRate = parseRate(req.body?.billingRate)

    if (!name) {
      return res.status(400).json({ success: false, message: "Activity type name is required" })
    }
    if (name.length > ACTIVITY_NAME_MAX) {
      return res.status(400).json({
        success: false,
        message: `Activity type name must be at most ${ACTIVITY_NAME_MAX} characters`,
      })
    }
    // The suffix is reserved for the automatic overtime twins; refusing it here also means no
    // name can ever collide with another type's twin.
    if (hasOvertimeSuffix(name)) {
      return res.status(400).json({
        success: false,
        message: `A name can't end with "${OVERTIME_SUFFIX.trim()}" — the overtime type is created automatically`,
      })
    }
    if (costingRate === null) {
      return res.status(400).json({ success: false, message: "Costing rate is required (a number, 0 or more)" })
    }
    if (billingRate === null) {
      return res.status(400).json({ success: false, message: "Billing rate is required (a number, 0 or more)" })
    }

    // ERPNext Activity Type names are one namespace; the unique index is case-sensitive, so
    // refuse a name differing only in case as well.
    const clash = await activityTypeModel.exists({
      name: { $regex: `^${escapeRegExp(name)}$`, $options: "i" },
    })
    if (clash) {
      return res.status(409).json({ success: false, message: "An activity type with this name already exists" })
    }

    const type = await activityTypeModel.create({ name, costingRate, billingRate })
    const multiplier = await loadMultiplier()
    res.status(201).json({
      success: true,
      message: "Activity type created",
      data: { ...withOvertime(type, multiplier), allocatedCount: 0 },
    })
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "An activity type with this name already exists" })
    }
    console.log(error)
    res.status(500).json({ success: false, message: "Internal server error" })
  }
}

// PATCH /api/activity-types/:id { costingRate, billingRate } — rates only; the name is an
// ERPNext link key and stays fixed.
export const updateActivityType = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Activity type not found" })
    }
    const costingRate = parseRate(req.body?.costingRate)
    const billingRate = parseRate(req.body?.billingRate)
    if (costingRate === null) {
      return res.status(400).json({ success: false, message: "Costing rate is required (a number, 0 or more)" })
    }
    if (billingRate === null) {
      return res.status(400).json({ success: false, message: "Billing rate is required (a number, 0 or more)" })
    }

    const type = await activityTypeModel.findByIdAndUpdate(
      req.params.id,
      { costingRate, billingRate },
      { new: true, runValidators: true }
    )
    if (!type) {
      return res.status(404).json({ success: false, message: "Activity type not found" })
    }
    const [multiplier, allocatedCount] = await Promise.all([
      loadMultiplier(),
      empModel.countDocuments({ activityType: type._id, isActive: true }),
    ])
    res.status(200).json({
      success: true,
      message: "Rates updated",
      data: { ...withOvertime(type, multiplier), allocatedCount },
    })
  } catch (error) {
    console.log(error)
    res.status(500).json({ success: false, message: "Internal server error" })
  }
}

// DELETE /api/activity-types/:id — refused while any employee (active or not) is allocated.
export const deleteActivityType = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Activity type not found" })
    }
    const allocated = await empModel.countDocuments({ activityType: req.params.id })
    if (allocated > 0) {
      return res.status(409).json({
        success: false,
        message: `Unallocate the ${allocated} employee${allocated === 1 ? "" : "s"} on this activity type first`,
      })
    }
    const deleted = await activityTypeModel.findByIdAndDelete(req.params.id)
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Activity type not found" })
    }
    res.status(200).json({ success: true, message: "Activity type deleted" })
  } catch (error) {
    console.log(error)
    res.status(500).json({ success: false, message: "Internal server error" })
  }
}

// POST /api/activity-types/allocate { activityTypeId | null, employeeIds: [Mongo _id] }
// Sets (or, with null, clears) the activity type of every listed employee.
export const allocateActivityType = async (req, res) => {
  try {
    const { activityTypeId = null, employeeIds } = req.body || {}

    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ success: false, message: "Select at least one employee" })
    }
    if (!employeeIds.every((id) => mongoose.isValidObjectId(id))) {
      return res.status(400).json({ success: false, message: "Invalid employeeId" })
    }

    let typeName = null
    if (activityTypeId !== null) {
      if (!mongoose.isValidObjectId(activityTypeId)) {
        return res.status(400).json({ success: false, message: "Invalid activityTypeId" })
      }
      const type = await activityTypeModel.findById(activityTypeId, "name").lean()
      if (!type) {
        return res.status(404).json({ success: false, message: "Activity type not found" })
      }
      typeName = type.name
    }

    const result = await empModel.updateMany(
      { _id: { $in: employeeIds } },
      { $set: { activityType: activityTypeId } }
    )
    res.status(200).json({
      success: true,
      message: typeName
        ? `Allocated "${typeName}" to ${result.matchedCount} employee${result.matchedCount === 1 ? "" : "s"}`
        : `Cleared the activity type of ${result.matchedCount} employee${result.matchedCount === 1 ? "" : "s"}`,
      data: { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount },
    })
  } catch (error) {
    console.log(error)
    res.status(500).json({ success: false, message: "Internal server error" })
  }
}

// GET /api/activity-types/erpnext?mode=insert|update
// ERPNext Data Import CSV for the Activity Type doctype: each type and its overtime twin with
// their default rates. "insert" → Insert New Records; "update" adds the ID column (the
// document name = the activity type name) for Update Existing Records after a re-rate.
// Labels must match the instance's Download Template.
export const exportActivityTypesErpnext = async (req, res) => {
  try {
    const mode = String(req.query.mode || "insert").toLowerCase()
    if (mode !== "insert" && mode !== "update") {
      return res.status(400).json({ success: false, message: "mode must be one of: insert, update" })
    }

    const [types, multiplier] = await Promise.all([
      activityTypeModel.find({}).sort({ name: 1 }).lean(),
      loadMultiplier(),
    ])

    const withId = mode === "update"
    const header = [
      ...(withId ? ["ID"] : []),
      "Activity Type",
      "Default Costing Rate",
      "Default Billing Rate",
    ]
    const rows = []
    for (const t of types) {
      const o = withOvertime(t, multiplier)
      rows.push([...(withId ? [o.name] : []), o.name, o.costingRate, o.billingRate])
      rows.push([
        ...(withId ? [o.overtimeName] : []),
        o.overtimeName,
        o.overtimeCostingRate,
        o.overtimeBillingRate,
      ])
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8")
    res.setHeader("Content-Disposition", `attachment; filename="erpnext-activity-types-${mode}.csv"`)
    // Leading BOM so Excel opens the UTF-8 CSV with the right encoding.
    return res.status(200).send("﻿" + toCsv(header, rows))
  } catch (error) {
    console.log(error)
    res.status(500).json({ success: false, message: "Failed to generate the activity type export" })
  }
}

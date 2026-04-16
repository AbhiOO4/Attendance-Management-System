import Joi from 'joi'

const employeeValidationSchema = Joi.object({
  name: Joi.string()
    .trim()
    .required()
    .messages({
      'any.required': 'Employee name is required',
      'string.empty': 'Employee name cannot be empty',
    }),

  employeeId: Joi.string()
    .uppercase()
    .trim()
    .required()
    .messages({
      'any.required': 'Employee ID is required',
      'string.empty': 'Employee ID cannot be empty',
    }),

  jobTitle: Joi.string()
    .trim()
    .required()
    .messages({
      'any.required': 'Job title is required',
      'string.empty': 'Job title cannot be empty',
    }),

  currentSite: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/) // Mongo ObjectId regex
    .optional()
    .allow(null),
  
  isSupervisor: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional()
    .allow(null),


  status: Joi.string()
    .valid('active', 'inactive')
    .default('active')
    .messages({
      'any.only': '{#value} is not a valid status',
    }),
});



export const employeeValidation = (req, res, next) => {
    const {error, value} = employeeValidationSchema.validate(req.body)
    if (error){
        return res.status(400).json({message: error.details[0].message})
    }
    req.body = value
    next()
}
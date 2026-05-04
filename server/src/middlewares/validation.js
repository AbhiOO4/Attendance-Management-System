import Joi from 'joi'


const employeeSchema = Joi.object({
  name: Joi.string().trim().required()
    .messages({
      'string.empty': 'Employee name is required'
    }),

  employeeId: Joi.string().trim().uppercase().required()
    .messages({
      'string.empty': 'Employee ID is required'
    }),

  jobTitle: Joi.string().trim().required()
    .messages({
      'string.empty': 'Job title is required'
    }),

  user: Joi.string().hex().length(24).optional(), // ObjectId
  currentSite: Joi.string().hex().length(24).optional(),  // ObjectId

  isActive: Joi.boolean().default(true),

  monthlySalary: Joi.number()
    .min(0)
    .messages({
      'any.required': 'Monthly salary is required for salaried employees',
    }),

});


const supervisorValidationSchema = Joi.object({
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
  email: Joi.string()
    .email()
    .required(),
  password: Joi.string()
    .min(6)
    .max(30)
    .required()
})



export const employeeValidation = (req, res, next) => {
    const {error, value} = employeeSchema.validate(req.body)
    if (error){
        return res.status(400).json({message: error.details[0].message})
    }
    req.body = value
    next()
}

export const supervisorValidation = (req, res, next) => {
  const {error, value} = supervisorValidationSchema.validate(req.body)
    if (error){
        return res.status(400).json({message: error.details[0].message})
    }
    req.body = value
    next()
}
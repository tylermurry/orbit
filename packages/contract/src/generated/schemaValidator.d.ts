// Types for the generated standalone validator (see scripts/gen-validator.mjs).
import type { ErrorObject } from 'ajv';
declare const validate: ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };
export default validate;
export { validate };

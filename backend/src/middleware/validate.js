// Factory de middleware de validation Zod.
// Valide req.body (par défaut) ou req.query si source = 'query'.
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        details: result.error.errors.map(({ path, message }) => ({
          field: path.join('.') || source,
          message,
        })),
      });
    }

    // Remplace par la version parsée/sanitisée (strips unknown keys)
    req[source] = result.data;
    next();
  };
}

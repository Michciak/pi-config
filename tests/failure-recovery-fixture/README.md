# Pi failure/recovery fixture

This isolated fixture is intentionally broken in two production functions.
The tests are correct and must not be edited.

Expected workflow:

1. inspect the source and tests,
2. run `npm test` and observe failure,
3. fix only `src/math.js`,
4. rerun tests after each change,
5. finish only when all tests pass.

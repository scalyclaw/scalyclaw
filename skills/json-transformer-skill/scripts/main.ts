import { search } from "@metrichor/jmespath";

try {
  const data = await Bun.stdin.json();
  const inputData = data.data;
  const expression: string = data.expression;

  if (inputData === undefined || inputData === null) {
    throw new Error("Missing required parameter: data");
  }

  if (!expression) {
    throw new Error("Missing required parameter: expression");
  }

  console.error(`Applying JMESPath expression: ${expression}`);

  const result = search(inputData, expression);

  console.log(JSON.stringify({ result }));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}

declare module "ajv-formats" {
  import type Ajv from "ajv";

  function addFormats(ajv: Ajv): void;
  export default addFormats;
  export { addFormats };
}
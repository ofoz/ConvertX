import Elysia, { t } from "elysia";

import { FormatPicker } from "../components/formatPicker";
import { getPossibleTargets } from "../converters/main";
import { userService } from "./user";

export const chooseConverter = new Elysia()
  .use(userService)
  .post(
    "/conversions",
    ({ body }) => <FormatPicker targets={getPossibleTargets(body.fileType)} />,
    { body: t.Object({ fileType: t.String() }) },
  );

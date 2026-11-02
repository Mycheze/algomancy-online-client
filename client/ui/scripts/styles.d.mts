/** parse an order file's text (styles/index.css) into its piece paths */
export function parseOrder(text: string): string[];
/** the pieces, in cascade order, as paths relative to the styles dir */
export function stylesOrder(dir?: string): string[];
/** every `.css` file under the styles dir except index.css, relative, sorted */
export function stylesOnDisk(dir?: string): string[];
/** the whole stylesheet: every piece, in order, concatenated with nothing between */
export function concatStyles(dir?: string): string;

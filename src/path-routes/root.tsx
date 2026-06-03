import { rootRoute } from './__root';
import { hostRoute, indexRoute } from './host';

export { rootRoute };
export const routeTree = rootRoute.addChildren([indexRoute, hostRoute]);

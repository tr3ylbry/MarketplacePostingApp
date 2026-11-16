import { mediaFixture } from "./mediaFixture";
import { requireMediaTestBuild, testMediaGateway } from "./testMediaGateway";
export function mediaRuntime() {
  requireMediaTestBuild();
  return { enabled: true as const, fixture: mediaFixture, gateway: testMediaGateway() };
}

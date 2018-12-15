import { sovietCountryIsoCodes, colors, sovietLabelShift } from "./constants";

var mercatorBounds = function(projection, maxlat) {
  var yaw = projection.rotate()[0],
    xymax = projection([-yaw + 180 - 1e-6, -maxlat]),
    xymin = projection([-yaw - 180 + 1e-6, maxlat]);

  return [xymin, xymax];
};

export default function paintMap(countries) {
  const mapContainer = d3.select(".scroll__graphic");
  const boundingBox = mapContainer.node().getBoundingClientRect();
  const { height, width } = boundingBox;

  var rotate = -20; // so that [-60, 0] becomes initial center of projection
  var maxlat = 83;

  var projection = d3.geo
    .mercator()
    .rotate([rotate, 0])
    .scale(1) // we'll scale up to match viewport shortly.
    .translate([width / 2, height / 2]);
  // .center([0, 25])
  var b = mercatorBounds(projection, maxlat);
  var s = width / (b[1][0] - b[0][0]);
  var scaleExtent = [s, 10 * s];

  projection.scale(scaleExtent[0]);

  var path = d3.geo.path().projection(projection);

  const svg = d3
    .select(".scroll__graphic")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const map = svg.append("g").attr("id", "map");

  map
    .selectAll("path")
    .data(countries)
    .enter()
    .append("path")
    .attr("d", path)
    .style("stroke-width", 0.5 + "px")
    .attr("class", "country")
    .attr("id", function(d, i) {
      return "country" + d.id;
    })
    .attr("class", function(datapoint, i) {
      if (sovietCountryIsoCodes.includes(datapoint.id)) {
        return "country soviet-country";
      } else {
        return "country non-soviet-country";
      }
    });
}

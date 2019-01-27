import {
  sovietCountryIsoCodes,
  colors,
  sovietLabelShift,
  netFsuMigrationOne,
  netFsuMigrationTwo,
  populationsIn1991
} from "./constants";

function zeroAnimation(worldMap) {
  worldMap.animateSectionStyles({ 
    duration: 1000, 
    section: '.non-soviet-country', 
    styles: { 
      opacity: '0.5',
      'stroke-width': '0.25px' 
    }
  })
}

function firstAnimation(worldMap) {
  const zoomParams = {
    scale: 4,
    duration: 1000,
    translateX: (-Math.floor(worldMap.width * 0.462)),
    translateY: -Math.floor(worldMap.height * 0.2),
  }

  worldMap.animateMapZoom(zoomParams)

  worldMap.createLabels()

  worldMap.createPopulationChoropleth()

  worldMap.animateSectionStyles({ 
    duration: 500, 
    section: '.non-soviet-country', 
    styles: { 
      opacity: '0',
      'stroke-width': '0.175px' 
    }
  })
}

function secondAnimation(worldMap, barChart) {
  worldMap.moveMapContainer({
    duration: 1000,
    top: 0
  })
  barChart.fadeTextIn()
  barChart.animateBarsIn()
  barChart.addPopulationLabels()
}

function thirdAnimation(worldMap, barChart) {

  //
}

function fourthAnimation(worldMap, barChart) {
  worldMap.addPointsToMap()
  worldMap.drawCurves()
  barChart.redrawBarsAndLabels(netFsuMigrationOne)

  // worldMap.drawLabelPointer()
}

function fifthAnimation (worldMap, barChart) {
  barChart.redrawBarsAndLabels(netFsuMigrationTwo)
}

export default {
  0: zeroAnimation,
  1: firstAnimation,
  2: secondAnimation,
  3: thirdAnimation,
  4: fourthAnimation,
  5: fifthAnimation,
  6: () => {}
};

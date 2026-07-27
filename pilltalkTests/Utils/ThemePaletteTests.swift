import XCTest
import SwiftUI
@testable import pilltalk

final class ThemePaletteTests: XCTestCase {
    func test_accentGradientColors_sameAcrossThemesAndColorSchemes() {
        let combinations: [(AppTheme, ColorScheme)] = [
            (.matrix, .light), (.matrix, .dark),
            (.liquidGlass, .light), (.liquidGlass, .dark)
        ]
        for (theme, scheme) in combinations {
            let palette = theme.palette(for: scheme)
            XCTAssertEqual(
                palette.accentGradientColors,
                ThemePalette.defaultAccentGradientColors,
                "gradient should be identical for \(theme)/\(scheme)"
            )
        }
    }

    func test_accentGradientColors_isGreenToRed() {
        let colors = ThemePalette.defaultAccentGradientColors
        XCTAssertEqual(colors.count, 2)
        XCTAssertEqual(colors[0], Color(red: 0.1843, green: 0.7490, blue: 0.4431)) // #2FBF71
        XCTAssertEqual(colors[1], Color(red: 0.8824, green: 0.2941, blue: 0.2941)) // #E14B4B
    }
}

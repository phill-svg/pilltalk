// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "pilltalk",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "pilltalk",
            targets: ["pilltalk"]
        )
    ],
    dependencies: [
        .package(path: "localPackages/Arti"),
        .package(path: "localPackages/BitFoundation"),
        .package(path: "localPackages/BitLogger"),
        .package(url: "https://github.com/21-DOT-DEV/swift-secp256k1", exact: "0.21.1")
    ],
    targets: [
        .executableTarget(
            name: "pilltalk",
            dependencies: [
                .product(name: "P256K", package: "swift-secp256k1"),
                .product(name: "BitFoundation", package: "BitFoundation"),
                .product(name: "BitLogger", package: "BitLogger"),
                .product(name: "Tor", package: "Arti")
            ],
            path: "pilltalk",
            exclude: [
                "Info.plist",
                "Assets.xcassets",
                "_PreviewHelpers/PreviewAssets.xcassets",
                "pilltalk.entitlements",
                "pilltalk-macOS.entitlements",
                "LaunchScreen.storyboard",
                "ViewModels/Extensions/README.md"
            ],
            resources: [
                .process("Localizable.xcstrings")
            ]
        ),
        .testTarget(
            name: "pilltalkTests",
            dependencies: [
                "pilltalk",
                .product(name: "BitFoundation", package: "BitFoundation")
            ],
            path: "pilltalkTests",
            exclude: [
                "Info.plist",
                "README.md",
                // CI perf gate data (read by scripts/check-perf-floors.sh),
                // not a test resource.
                "Performance/perf-floors.json"
            ],
            resources: [
                .process("Localization"),
                // Only the vector fixture: declaring the whole "Noise"
                // directory would claim its .swift test files as resources
                // and silently drop them from compilation.
                .process("Noise/NoiseTestVectors.json")
            ]
        )
    ]
)
